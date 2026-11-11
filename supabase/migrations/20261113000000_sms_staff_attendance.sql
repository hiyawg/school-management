-- Staff attendance and leave.
-- Run after 20261112000000_sms_staff.sql.

-- Staff attendance ---------------------------------------------------------

CREATE TABLE sms.staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT current_date,
  status text NOT NULL CHECK (status IN ('present', 'late', 'absent', 'on_leave')),
  check_in time,
  note text,
  marked_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, user_id, date)
);
CREATE INDEX idx_sms_staff_attendance_date ON sms.staff_attendance(school_id, date);

ALTER TABLE sms.staff_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins or self read" ON sms.staff_attendance FOR SELECT TO authenticated
  USING (sms.is_admin(school_id) OR user_id = auth.uid());
CREATE POLICY "admins write" ON sms.staff_attendance FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));

-- Leave types --------------------------------------------------------------
-- Each school edits its own list. days_per_year NULL means no fixed allowance.

CREATE TABLE sms.leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  name text NOT NULL,
  days_per_year numeric CHECK (days_per_year >= 0),
  paid boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

-- Starting list, based on the Ethiopian Labour Proclamation (1156/2019). Schools should check and adjust it.
CREATE OR REPLACE FUNCTION sms.seed_leave_types(_school_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = sms, public AS $$
  INSERT INTO sms.leave_types (school_id, name, days_per_year, paid) VALUES
    (_school_id, 'Annual', 16, true),
    (_school_id, 'Sick', NULL, true),
    (_school_id, 'Maternity', 120, true),
    (_school_id, 'Paternity', 3, true),
    (_school_id, 'Bereavement', 3, true),
    (_school_id, 'Marriage', 3, true),
    (_school_id, 'Unpaid', NULL, false)
  ON CONFLICT (school_id, name) DO NOTHING
$$;

CREATE OR REPLACE FUNCTION sms.seed_leave_types_for_new_school() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
BEGIN
  PERFORM sms.seed_leave_types(NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_schools_leave_types AFTER INSERT ON sms.schools
FOR EACH ROW EXECUTE FUNCTION sms.seed_leave_types_for_new_school();

SELECT sms.seed_leave_types(id) FROM sms.schools;

ALTER TABLE sms.leave_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read" ON sms.leave_types FOR SELECT TO authenticated USING (sms.is_staff(school_id));
CREATE POLICY "admins write" ON sms.leave_types FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));

-- Leave requests -----------------------------------------------------------

CREATE TABLE sms.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES sms.leave_types(id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date date NOT NULL,
  days numeric NOT NULL DEFAULT 0,  -- working days (Mon–Fri), set by trigger
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_sms_leave_user ON sms.leave_requests(school_id, user_id);

CREATE OR REPLACE FUNCTION sms.working_days(_from date, _to date) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT count(*)::integer FROM generate_series(_from, _to, interval '1 day') d WHERE extract(isodow FROM d) < 6
$$;

CREATE OR REPLACE FUNCTION sms.leave_set_days() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.days = sms.working_days(NEW.start_date, NEW.end_date);
  IF NOT EXISTS (SELECT 1 FROM sms.leave_types WHERE id = NEW.leave_type_id AND school_id = NEW.school_id) THEN
    RAISE EXCEPTION 'Unknown leave type for this school' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_leave_days BEFORE INSERT OR UPDATE OF start_date, end_date, leave_type_id ON sms.leave_requests
FOR EACH ROW EXECUTE FUNCTION sms.leave_set_days();

ALTER TABLE sms.leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins or self read" ON sms.leave_requests FOR SELECT TO authenticated
  USING (sms.is_admin(school_id) OR user_id = auth.uid());
-- Staff request for themselves; administrators may also record a request for someone.
-- Every request starts pending and is decided through sms.decide_leave.
CREATE POLICY "staff request" ON sms.leave_requests FOR INSERT TO authenticated
  WITH CHECK (status = 'pending' AND decided_by IS NULL
              AND ((user_id = auth.uid() AND sms.is_staff(school_id)) OR sms.is_admin(school_id)));
-- No UPDATE or DELETE policy: changes go through the two functions below.

-- Approve or reject a pending request. Approval marks its working days as on leave in the staff register,
-- replacing an 'absent' mark (sick leave recorded afterwards) but leaving present or late days alone.
CREATE OR REPLACE FUNCTION sms.decide_leave(_request_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE _r sms.leave_requests;
BEGIN
  SELECT * INTO _r FROM sms.leave_requests WHERE id = _request_id FOR UPDATE;
  IF _r.id IS NULL OR NOT sms.is_admin(_r.school_id) THEN
    RAISE EXCEPTION 'Only school administrators can decide leave' USING ERRCODE = '42501';
  END IF;
  IF _r.user_id = auth.uid() AND (SELECT count(*) FROM sms.school_members WHERE school_id = _r.school_id AND role = 'school_admin') > 1 THEN
    RAISE EXCEPTION 'Another administrator must decide your own leave' USING ERRCODE = '42501';
  END IF;
  IF _r.status <> 'pending' THEN
    RAISE EXCEPTION 'This request was already %', _r.status USING ERRCODE = '22023';
  END IF;

  UPDATE sms.leave_requests
  SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(_note), '')
  WHERE id = _request_id;

  IF _approve THEN
    INSERT INTO sms.staff_attendance (school_id, user_id, date, status, note, marked_by)
    SELECT _r.school_id, _r.user_id, d::date, 'on_leave', 'Approved leave', auth.uid()
    FROM generate_series(_r.start_date, _r.end_date, interval '1 day') d
    WHERE extract(isodow FROM d) < 6
    ON CONFLICT (school_id, user_id, date) DO UPDATE SET status = 'on_leave', note = 'Approved leave'
      WHERE sms.staff_attendance.status = 'absent';
  END IF;
END $$;

-- The requester withdraws a request that has not been decided yet.
CREATE OR REPLACE FUNCTION sms.cancel_leave(_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
BEGIN
  UPDATE sms.leave_requests SET status = 'cancelled'
  WHERE id = _request_id AND user_id = auth.uid() AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only your own pending requests can be cancelled' USING ERRCODE = '42501';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON sms.staff_attendance, sms.leave_types TO authenticated;
GRANT SELECT, INSERT ON sms.leave_requests TO authenticated;
GRANT ALL ON sms.staff_attendance, sms.leave_types, sms.leave_requests TO service_role;
REVOKE ALL ON FUNCTION sms.seed_leave_types, sms.seed_leave_types_for_new_school, sms.working_days,
  sms.leave_set_days, sms.decide_leave, sms.cancel_leave FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sms.working_days, sms.decide_leave, sms.cancel_leave TO authenticated, service_role;
