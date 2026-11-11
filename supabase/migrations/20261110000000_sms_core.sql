-- School Management System core schema, for its own Supabase project.
-- Columns ending in the education app's names (learning_student_id, curriculum_grade_id,
-- skill_id, exam_set_id) hold IDs from the education project. They are plain uuids with no
-- foreign keys, because that data lives in a different database.

CREATE SCHEMA IF NOT EXISTS sms;
GRANT USAGE ON SCHEMA sms TO authenticated, service_role;

CREATE TYPE sms.school_role AS ENUM ('school_admin', 'teacher', 'parent', 'student');
CREATE TYPE sms.attendance_status AS ENUM ('present', 'absent', 'late', 'excused');
CREATE TYPE sms.assessment_kind AS ENUM ('quiz', 'test', 'assignment', 'midterm', 'final', 'learning_skill', 'learning_exam');

CREATE OR REPLACE FUNCTION sms.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- Schools and membership --------------------------------------------------

CREATE TABLE sms.schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE,
  region text,
  city text,
  phone text,
  -- SET NULL so the education app's account deletion is never blocked by a school record.
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sms.school_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role sms.school_role NOT NULL,
  full_name text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, user_id, role)
);
CREATE INDEX idx_sms_members_user ON sms.school_members(user_id);

-- SECURITY DEFINER so RLS policies can call it without recursing into school_members' own policies.
CREATE OR REPLACE FUNCTION sms.has_school_role(_school_id uuid, _roles sms.school_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sms.school_members
    WHERE school_id = _school_id AND user_id = auth.uid() AND role = ANY(_roles)
  )
$$;

CREATE OR REPLACE FUNCTION sms.is_staff(_school_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT sms.has_school_role(_school_id, ARRAY['school_admin', 'teacher']::sms.school_role[])
$$;

CREATE OR REPLACE FUNCTION sms.is_admin(_school_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT sms.has_school_role(_school_id, ARRAY['school_admin']::sms.school_role[])
$$;

-- The creator of a school becomes its first administrator.
CREATE OR REPLACE FUNCTION sms.add_creator_as_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
BEGIN
  INSERT INTO sms.school_members (school_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'school_admin')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_schools_creator_admin AFTER INSERT ON sms.schools
FOR EACH ROW EXECUTE FUNCTION sms.add_creator_as_admin();
CREATE TRIGGER trg_schools_touch BEFORE UPDATE ON sms.schools
FOR EACH ROW EXECUTE FUNCTION sms.touch_updated_at();

-- Calendar ----------------------------------------------------------------

CREATE TABLE sms.academic_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  name text NOT NULL,            -- e.g. '2019 E.C.'
  starts_on date,
  ends_on date,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CREATE UNIQUE INDEX uq_sms_one_current_year ON sms.academic_years(school_id) WHERE is_current;

CREATE TABLE sms.terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES sms.academic_years(id) ON DELETE CASCADE,
  name text NOT NULL,            -- e.g. 'Semester 1'
  starts_on date,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (academic_year_id, name)
);

-- Classes, students, enrollment ------------------------------------------

CREATE TABLE sms.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES sms.academic_years(id) ON DELETE CASCADE,
  grade_level integer NOT NULL CHECK (grade_level BETWEEN 0 AND 12),
  section text NOT NULL,         -- e.g. 'A'
  homeroom_teacher_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (academic_year_id, grade_level, section)
);

CREATE TABLE sms.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  student_code text,
  first_name text NOT NULL,
  father_name text NOT NULL,
  grandfather_name text,
  gender text CHECK (gender IN ('M', 'F')),
  date_of_birth date,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Education-app learner profile id. Set only through sms.set_learning_link (service role).
  learning_student_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, student_code)
);
CREATE TRIGGER trg_students_touch BEFORE UPDATE ON sms.students
FOR EACH ROW EXECUTE FUNCTION sms.touch_updated_at();

-- learning_student_id may only be set inside sms.set_learning_link, which sets this flag.
-- Clearing it is always allowed, so deleting a child in the education app (ON DELETE SET NULL) never fails.
CREATE OR REPLACE FUNCTION sms.guard_learning_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.learning_student_id IS NOT NULL
     AND NEW.learning_student_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.learning_student_id END)
     AND coalesce(current_setting('sms.linking', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Only a guardian can link a learning profile' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_students_guard_link BEFORE INSERT OR UPDATE ON sms.students
FOR EACH ROW EXECUTE FUNCTION sms.guard_learning_link();

CREATE TABLE sms.guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES sms.students(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  relationship text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_guardians_user ON sms.guardians(user_id);

CREATE TABLE sms.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES sms.classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES sms.students(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'transferred', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, student_id)
);

CREATE OR REPLACE FUNCTION sms.is_guardian_of(_student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (SELECT 1 FROM sms.guardians WHERE student_id = _student_id AND user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM sms.students WHERE id = _student_id AND user_id = auth.uid())
$$;

-- Subjects taught per class, linked to the shared curriculum -------------

CREATE TABLE sms.class_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES sms.classes(id) ON DELETE CASCADE,
  subject_name text NOT NULL,
  -- Education-app public.grades.grade_id (one subject at one grade level).
  curriculum_grade_id uuid,
  teacher_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, subject_name)
);

-- Attendance -------------------------------------------------------------

CREATE TABLE sms.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES sms.classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES sms.students(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT current_date,
  status sms.attendance_status NOT NULL,
  note text,
  marked_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, student_id, date)
);
CREATE INDEX idx_sms_attendance_class_date ON sms.attendance(class_id, date);

-- Gradebook --------------------------------------------------------------

CREATE TABLE sms.assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  class_subject_id uuid NOT NULL REFERENCES sms.class_subjects(id) ON DELETE CASCADE,
  term_id uuid REFERENCES sms.terms(id) ON DELETE SET NULL,
  title text NOT NULL,
  kind sms.assessment_kind NOT NULL DEFAULT 'test',
  max_score numeric NOT NULL DEFAULT 100 CHECK (max_score > 0),
  weight numeric NOT NULL DEFAULT 0 CHECK (weight >= 0),
  held_on date,
  due_on date,
  -- Learning-app assignment: a skill or exam set from the education app.
  skill_id uuid,
  exam_set_id uuid,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'learning_skill' OR skill_id IS NOT NULL),
  CHECK (kind <> 'learning_exam' OR exam_set_id IS NOT NULL)
);

CREATE TABLE sms.scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES sms.assessments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES sms.students(id) ON DELETE CASCADE,
  score numeric CHECK (score >= 0),
  comment text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, student_id)
);
CREATE TRIGGER trg_scores_touch BEFORE UPDATE ON sms.scores
FOR EACH ROW EXECUTE FUNCTION sms.touch_updated_at();

-- Row level security -----------------------------------------------------

ALTER TABLE sms.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.school_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.class_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.scores ENABLE ROW LEVEL SECURITY;

-- created_by lets INSERT ... RETURNING succeed before the creator-admin trigger row is visible.
CREATE POLICY "members read school" ON sms.schools FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR sms.has_school_role(id, enum_range(NULL::sms.school_role)));
CREATE POLICY "anyone signed in creates a school" ON sms.schools FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "admins update school" ON sms.schools FOR UPDATE TO authenticated
  USING (sms.is_admin(id)) WITH CHECK (sms.is_admin(id));

CREATE POLICY "members see own rows, staff see all" ON sms.school_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR sms.is_staff(school_id));
CREATE POLICY "admins manage members" ON sms.school_members FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));

-- Calendar, classes and subjects: every member reads, admins write.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['academic_years', 'terms', 'classes', 'class_subjects'] LOOP
    EXECUTE format('CREATE POLICY "members read" ON sms.%I FOR SELECT TO authenticated
      USING (sms.has_school_role(school_id, enum_range(NULL::sms.school_role)))', t);
    EXECUTE format('CREATE POLICY "admins write" ON sms.%I FOR ALL TO authenticated
      USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id))', t);
  END LOOP;
END $$;

-- Student records: staff read, admins write, guardians and the student read their own.
CREATE POLICY "staff or family read" ON sms.students FOR SELECT TO authenticated
  USING (sms.is_staff(school_id) OR sms.is_guardian_of(id));
CREATE POLICY "admins write" ON sms.students FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));

CREATE POLICY "staff or self read" ON sms.guardians FOR SELECT TO authenticated
  USING (sms.is_staff(school_id) OR user_id = auth.uid());
CREATE POLICY "admins write" ON sms.guardians FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));

CREATE POLICY "staff or family read" ON sms.enrollments FOR SELECT TO authenticated
  USING (sms.is_staff(school_id) OR sms.is_guardian_of(student_id));
CREATE POLICY "admins write" ON sms.enrollments FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));

-- Attendance, assessments and scores: teachers and admins write.
CREATE POLICY "staff or family read" ON sms.attendance FOR SELECT TO authenticated
  USING (sms.is_staff(school_id) OR sms.is_guardian_of(student_id));
CREATE POLICY "staff write" ON sms.attendance FOR ALL TO authenticated
  USING (sms.is_staff(school_id)) WITH CHECK (sms.is_staff(school_id));

CREATE POLICY "members read" ON sms.assessments FOR SELECT TO authenticated
  USING (sms.has_school_role(school_id, enum_range(NULL::sms.school_role)));
CREATE POLICY "staff write" ON sms.assessments FOR ALL TO authenticated
  USING (sms.is_staff(school_id)) WITH CHECK (sms.is_staff(school_id));

CREATE POLICY "staff or family read" ON sms.scores FOR SELECT TO authenticated
  USING (sms.is_staff(school_id) OR sms.is_guardian_of(student_id));
CREATE POLICY "staff write" ON sms.scores FOR ALL TO authenticated
  USING (sms.is_staff(school_id)) WITH CHECK (sms.is_staff(school_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sms TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA sms TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sms FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sms TO authenticated, service_role;

-- Admin helper: add an existing account to the school by email ----------

CREATE OR REPLACE FUNCTION sms.add_member_by_email(
  _school_id uuid, _email text, _role sms.school_role, _full_name text DEFAULT NULL, _phone text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE _user_id uuid; _member_id uuid;
BEGIN
  IF NOT sms.is_admin(_school_id) THEN
    RAISE EXCEPTION 'Only school administrators can add members' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO _user_id FROM auth.users WHERE lower(email) = lower(trim(_email));
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'No account with email %. Ask them to sign up first.', _email USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO sms.school_members (school_id, user_id, role, full_name, phone)
  VALUES (_school_id, _user_id, _role, _full_name, _phone)
  ON CONFLICT (school_id, user_id, role) DO UPDATE
    SET full_name = COALESCE(EXCLUDED.full_name, sms.school_members.full_name),
        phone = COALESCE(EXCLUDED.phone, sms.school_members.phone)
  RETURNING id INTO _member_id;
  RETURN _member_id;
END $$;

-- Admin helper: add a guardian; with an email, the account also gets parent access.
CREATE OR REPLACE FUNCTION sms.add_guardian(
  _student_id uuid, _full_name text, _phone text DEFAULT NULL, _relationship text DEFAULT NULL, _email text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE _school_id uuid; _user_id uuid; _guardian_id uuid;
BEGIN
  SELECT school_id INTO _school_id FROM sms.students WHERE id = _student_id;
  IF _school_id IS NULL OR NOT sms.is_admin(_school_id) THEN
    RAISE EXCEPTION 'Only school administrators can add guardians' USING ERRCODE = '42501';
  END IF;
  IF nullif(trim(_email), '') IS NOT NULL THEN
    SELECT id INTO _user_id FROM auth.users WHERE lower(email) = lower(trim(_email));
    IF _user_id IS NULL THEN
      RAISE EXCEPTION 'No account with email %. Save without email, or ask the parent to sign up first.', _email USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO sms.school_members (school_id, user_id, role, full_name, phone)
    VALUES (_school_id, _user_id, 'parent', _full_name, _phone)
    ON CONFLICT (school_id, user_id, role) DO NOTHING;
  END IF;
  INSERT INTO sms.guardians (school_id, student_id, full_name, phone, relationship, user_id)
  VALUES (_school_id, _student_id, _full_name, _phone, _relationship, _user_id)
  RETURNING id INTO _guardian_id;
  RETURN _guardian_id;
END $$;

-- Link to the education app ---------------------------------------------

-- Called only by a trusted server-side bridge (service role) after the parent has proven,
-- in the education app, that they own the learner profile. Browsers can never call it.
CREATE OR REPLACE FUNCTION sms.set_learning_link(_sms_student_id uuid, _learning_student_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
BEGIN
  PERFORM set_config('sms.linking', 'on', true);
  UPDATE sms.students SET learning_student_id = _learning_student_id WHERE id = _sms_student_id;
  PERFORM set_config('sms.linking', '', true);
END $$;

REVOKE ALL ON FUNCTION sms.add_member_by_email, sms.add_guardian FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sms.add_member_by_email, sms.add_guardian TO authenticated;
REVOKE ALL ON FUNCTION sms.set_learning_link FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sms.set_learning_link TO service_role;
