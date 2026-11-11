-- Teacher and staff management: assignments that control access, and staff profiles.
-- Run after 20261111000000_sms_students.sql.

-- Assignments control who may write ---------------------------------------
-- Before: any teacher could take attendance and enter grades for any class.
-- Now: attendance by the class's homeroom teacher or anyone teaching a subject in it;
-- assessments and scores only by the subject's teacher. Administrators can do both everywhere.

CREATE OR REPLACE FUNCTION sms.teaches_class(_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (SELECT 1 FROM sms.classes WHERE id = _class_id AND homeroom_teacher_id = auth.uid())
      OR EXISTS (SELECT 1 FROM sms.class_subjects WHERE class_id = _class_id AND teacher_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION sms.teaches_subject(_class_subject_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (SELECT 1 FROM sms.class_subjects WHERE id = _class_subject_id AND teacher_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION sms.teaches_assessment(_assessment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sms.assessments a JOIN sms.class_subjects cs ON cs.id = a.class_subject_id
    WHERE a.id = _assessment_id AND cs.teacher_id = auth.uid()
  )
$$;

DROP POLICY "staff write" ON sms.attendance;
CREATE POLICY "admins and class teachers write" ON sms.attendance FOR ALL TO authenticated
  USING (sms.is_admin(school_id) OR sms.teaches_class(class_id))
  WITH CHECK (sms.is_admin(school_id) OR sms.teaches_class(class_id));

DROP POLICY "staff write" ON sms.assessments;
CREATE POLICY "admins and subject teacher write" ON sms.assessments FOR ALL TO authenticated
  USING (sms.is_admin(school_id) OR sms.teaches_subject(class_subject_id))
  WITH CHECK (sms.is_admin(school_id) OR sms.teaches_subject(class_subject_id));

DROP POLICY "staff write" ON sms.scores;
CREATE POLICY "admins and subject teacher write" ON sms.scores FOR ALL TO authenticated
  USING (sms.is_admin(school_id) OR sms.teaches_assessment(assessment_id))
  WITH CHECK (sms.is_admin(school_id) OR sms.teaches_assessment(assessment_id));

-- Staff profiles -----------------------------------------------------------
-- One per person per school (a person can be both teacher and administrator).
-- Name and phone stay on school_members; this holds the employment record.

CREATE TABLE sms.staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id text,
  gender text CHECK (gender IN ('M', 'F')),
  date_of_birth date,
  qualification text,            -- e.g. 'BEd Mathematics'
  specialization text,           -- subjects they can teach
  hire_date date,
  employment_type text NOT NULL DEFAULT 'full_time'
    CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'volunteer')),
  address text,
  emergency_contact_name text,
  emergency_contact_phone text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, user_id),
  UNIQUE (school_id, employee_id)
);
CREATE TRIGGER trg_staff_profiles_touch BEFORE UPDATE ON sms.staff_profiles
FOR EACH ROW EXECUTE FUNCTION sms.touch_updated_at();

ALTER TABLE sms.staff_profiles ENABLE ROW LEVEL SECURITY;
-- Personal details (birth date, emergency contact): administrators and the person themselves only.
CREATE POLICY "admins or self read" ON sms.staff_profiles FOR SELECT TO authenticated
  USING (sms.is_admin(school_id) OR user_id = auth.uid());
CREATE POLICY "admins write" ON sms.staff_profiles FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));

-- Members' email, so the People page can show who is who. Filled from the account when added.
ALTER TABLE sms.school_members ADD COLUMN email text;
UPDATE sms.school_members m SET email = u.email FROM auth.users u WHERE u.id = m.user_id;

CREATE OR REPLACE FUNCTION sms.fill_member_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
BEGIN
  SELECT email INTO NEW.email FROM auth.users WHERE id = NEW.user_id;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_members_email BEFORE INSERT ON sms.school_members
FOR EACH ROW EXECUTE FUNCTION sms.fill_member_email();

GRANT SELECT, INSERT, UPDATE, DELETE ON sms.staff_profiles TO authenticated;
GRANT ALL ON sms.staff_profiles TO service_role;
REVOKE ALL ON FUNCTION sms.teaches_class, sms.teaches_subject, sms.teaches_assessment, sms.fill_member_email FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sms.teaches_class, sms.teaches_subject, sms.teaches_assessment TO authenticated, service_role;
