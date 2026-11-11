-- Timetable (bell schedule, weekly lessons with clash checks) and school holidays.
-- Run after 20261113000000_sms_staff_attendance.sql.

-- Bell schedule ------------------------------------------------------------

ALTER TABLE sms.schools ADD COLUMN school_days smallint NOT NULL DEFAULT 5 CHECK (school_days IN (5, 6));

CREATE TABLE sms.periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  name text NOT NULL,            -- e.g. 'Period 1', 'Break'
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  is_break boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (school_id, starts_at)
);

-- How many lessons a week each subject should get, to see what is still unscheduled.
ALTER TABLE sms.class_subjects ADD COLUMN periods_per_week smallint CHECK (periods_per_week BETWEEN 0 AND 30);

-- Lessons ------------------------------------------------------------------
-- The teacher comes from the class subject, so reassigning a subject moves all its lessons with it.

CREATE TABLE sms.timetable_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES sms.classes(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES sms.periods(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 6),   -- 1 = Monday
  class_subject_id uuid NOT NULL REFERENCES sms.class_subjects(id) ON DELETE CASCADE,
  room text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, weekday, period_id)
);
CREATE INDEX idx_sms_slots_time ON sms.timetable_slots(school_id, weekday, period_id);

-- A teacher (or room) busy at that time in another class of the same academic year.
-- Returns a readable description of the clash, or NULL.
CREATE OR REPLACE FUNCTION sms.slot_clash(_slot_id uuid, _class_id uuid, _weekday smallint, _period_id uuid,
                                          _teacher_id uuid, _room text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT CASE WHEN cs.teacher_id = _teacher_id THEN 'The teacher already has ' ELSE 'The room is already used by ' END
         || cs.subject_name || ' in ' || CASE WHEN c.grade_level = 0 THEN 'KG ' ELSE 'Grade ' || c.grade_level END
         || c.section || ' at that time'
  FROM sms.timetable_slots s
  JOIN sms.class_subjects cs ON cs.id = s.class_subject_id
  JOIN sms.classes c ON c.id = s.class_id
  WHERE s.id IS DISTINCT FROM _slot_id
    AND s.weekday = _weekday AND s.period_id = _period_id
    AND c.academic_year_id = (SELECT academic_year_id FROM sms.classes WHERE id = _class_id)
    AND ((_teacher_id IS NOT NULL AND cs.teacher_id = _teacher_id)
         OR (nullif(trim(_room), '') IS NOT NULL AND lower(trim(s.room)) = lower(trim(_room))))
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION sms.check_slot() RETURNS trigger
LANGUAGE plpgsql SET search_path = sms, public AS $$
DECLARE _teacher uuid; _clash text;
BEGIN
  SELECT teacher_id INTO _teacher FROM sms.class_subjects WHERE id = NEW.class_subject_id AND class_id = NEW.class_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That subject is not taught in this class' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sms.periods WHERE id = NEW.period_id AND school_id = NEW.school_id AND NOT is_break) THEN
    RAISE EXCEPTION 'Lessons can only be placed in teaching periods' USING ERRCODE = '22023';
  END IF;
  NEW.room = nullif(trim(NEW.room), '');
  _clash = sms.slot_clash(NEW.id, NEW.class_id, NEW.weekday, NEW.period_id, _teacher, NEW.room);
  IF _clash IS NOT NULL THEN
    RAISE EXCEPTION '%', _clash USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_slots_check BEFORE INSERT OR UPDATE ON sms.timetable_slots
FOR EACH ROW EXECUTE FUNCTION sms.check_slot();

-- Giving a subject to another teacher must not double-book them.
CREATE OR REPLACE FUNCTION sms.check_subject_teacher_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = sms, public AS $$
DECLARE _s sms.timetable_slots; _clash text;
BEGIN
  IF NEW.teacher_id IS NULL OR NEW.teacher_id IS NOT DISTINCT FROM OLD.teacher_id THEN RETURN NEW; END IF;
  FOR _s IN SELECT * FROM sms.timetable_slots WHERE class_subject_id = NEW.id LOOP
    _clash = sms.slot_clash(_s.id, _s.class_id, _s.weekday, _s.period_id, NEW.teacher_id, NULL);
    IF _clash IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot change the teacher: %', lower(left(_clash, 1)) || substr(_clash, 2) USING ERRCODE = '23P01';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_subject_teacher_clash BEFORE UPDATE OF teacher_id ON sms.class_subjects
FOR EACH ROW EXECUTE FUNCTION sms.check_subject_teacher_change();

-- Holidays -----------------------------------------------------------------

CREATE TABLE sms.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  date date NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, date)
);

-- Mon–Fri that are not school holidays.
CREATE OR REPLACE FUNCTION sms.school_working_days(_school_id uuid, _from date, _to date) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT count(*)::integer FROM generate_series(_from, _to, interval '1 day') d
  WHERE extract(isodow FROM d) < 6
    AND NOT EXISTS (SELECT 1 FROM sms.holidays h WHERE h.school_id = _school_id AND h.date = d::date)
$$;

-- Leave now skips holidays when counting days and when marking the staff register.
CREATE OR REPLACE FUNCTION sms.leave_set_days() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.days = sms.school_working_days(NEW.school_id, NEW.start_date, NEW.end_date);
  IF NOT EXISTS (SELECT 1 FROM sms.leave_types WHERE id = NEW.leave_type_id AND school_id = NEW.school_id) THEN
    RAISE EXCEPTION 'Unknown leave type for this school' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

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
      AND NOT EXISTS (SELECT 1 FROM sms.holidays h WHERE h.school_id = _r.school_id AND h.date = d::date)
    ON CONFLICT (school_id, user_id, date) DO UPDATE SET status = 'on_leave', note = 'Approved leave'
      WHERE sms.staff_attendance.status = 'absent';
  END IF;
END $$;

-- Access -------------------------------------------------------------------
-- Everyone in the school can see the timetable and holidays; administrators change them.

ALTER TABLE sms.periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.timetable_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.holidays ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['periods', 'timetable_slots', 'holidays'] LOOP
    EXECUTE format('CREATE POLICY "members read" ON sms.%I FOR SELECT TO authenticated
      USING (sms.has_school_role(school_id, enum_range(NULL::sms.school_role)))', t);
    EXECUTE format('CREATE POLICY "admins write" ON sms.%I FOR ALL TO authenticated
      USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id))', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON sms.periods, sms.timetable_slots, sms.holidays TO authenticated;
GRANT ALL ON sms.periods, sms.timetable_slots, sms.holidays TO service_role;
REVOKE ALL ON FUNCTION sms.slot_clash, sms.check_slot, sms.check_subject_teacher_change, sms.school_working_days
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sms.slot_clash, sms.school_working_days TO authenticated, service_role;
