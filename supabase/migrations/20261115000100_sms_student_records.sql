-- Student records: registrar access, student photos and documents, admissions.
-- Run after 20261115000000_sms_registrar_role.sql.

-- Registrar access ---------------------------------------------------------
-- Registrars count as staff (they read student records, appear in staff attendance and can request leave)
-- and, like administrators, can register and edit students. They cannot change setup, people, grades,
-- attendance or promotion.

CREATE OR REPLACE FUNCTION sms.is_staff(_school_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT sms.has_school_role(_school_id, ARRAY['school_admin', 'teacher', 'registrar']::sms.school_role[])
$$;

CREATE OR REPLACE FUNCTION sms.manages_students(_school_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT sms.has_school_role(_school_id, ARRAY['school_admin', 'registrar']::sms.school_role[])
$$;

DROP POLICY "admins write" ON sms.students;
CREATE POLICY "admins and registrars write" ON sms.students FOR ALL TO authenticated
  USING (sms.manages_students(school_id)) WITH CHECK (sms.manages_students(school_id));
DROP POLICY "admins write" ON sms.guardians;
CREATE POLICY "admins and registrars write" ON sms.guardians FOR ALL TO authenticated
  USING (sms.manages_students(school_id)) WITH CHECK (sms.manages_students(school_id));
DROP POLICY "admins write" ON sms.enrollments;
CREATE POLICY "admins and registrars write" ON sms.enrollments FOR ALL TO authenticated
  USING (sms.manages_students(school_id)) WITH CHECK (sms.manages_students(school_id));

CREATE OR REPLACE FUNCTION sms.add_guardian(
  _student_id uuid, _full_name text, _phone text DEFAULT NULL, _relationship text DEFAULT NULL, _email text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE _school_id uuid; _user_id uuid; _guardian_id uuid;
BEGIN
  SELECT school_id INTO _school_id FROM sms.students WHERE id = _student_id;
  IF _school_id IS NULL OR NOT sms.manages_students(_school_id) THEN
    RAISE EXCEPTION 'Only administrators and registrars can add guardians' USING ERRCODE = '42501';
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

-- Photos and documents -------------------------------------------------------
-- Files live in the private Storage bucket "student-files" at <school id>/<student id>/...
-- Staff and the student's guardians can open them; administrators and registrars upload and delete.

ALTER TABLE sms.students ADD COLUMN photo_path text;

CREATE TABLE sms.student_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES sms.students(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('birth_certificate', 'transfer_letter', 'report_card', 'medical', 'id_document', 'photo_id', 'other')),
  name text NOT NULL,            -- original file name
  path text NOT NULL UNIQUE,     -- object path in the bucket
  size_bytes bigint,
  uploaded_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_documents_student ON sms.student_documents(student_id);

ALTER TABLE sms.student_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff or family read" ON sms.student_documents FOR SELECT TO authenticated
  USING (sms.is_staff(school_id) OR sms.is_guardian_of(student_id));
CREATE POLICY "admins and registrars write" ON sms.student_documents FOR ALL TO authenticated
  USING (sms.manages_students(school_id)) WITH CHECK (sms.manages_students(school_id));

-- Path checks used by the Storage policies. Text comparison, so a malformed path is simply refused.
CREATE OR REPLACE FUNCTION sms.can_read_student_file(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sms.students s
    WHERE s.school_id::text = split_part(_path, '/', 1) AND s.id::text = split_part(_path, '/', 2)
      AND (sms.is_staff(s.school_id) OR sms.is_guardian_of(s.id))
  )
$$;

CREATE OR REPLACE FUNCTION sms.can_write_student_file(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sms.students s
    WHERE s.school_id::text = split_part(_path, '/', 1) AND s.id::text = split_part(_path, '/', 2)
      AND sms.manages_students(s.school_id)
  )
$$;

-- The bucket and its policies, when Supabase Storage is present.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'Supabase Storage not found; skipping the student-files bucket';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public) VALUES ('student-files', 'student-files', false)
  ON CONFLICT (id) DO NOTHING;
  EXECUTE $p$CREATE POLICY "sms student files read" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'student-files' AND sms.can_read_student_file(name))$p$;
  EXECUTE $p$CREATE POLICY "sms student files insert" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'student-files' AND sms.can_write_student_file(name))$p$;
  EXECUTE $p$CREATE POLICY "sms student files update" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'student-files' AND sms.can_write_student_file(name))
    WITH CHECK (bucket_id = 'student-files' AND sms.can_write_student_file(name))$p$;
  EXECUTE $p$CREATE POLICY "sms student files delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'student-files' AND sms.can_write_student_file(name))$p$;
END $$;

-- Admissions -----------------------------------------------------------------
-- applied → interview → accepted → enrolled (or rejected / withdrawn). Enrolling creates the student.

CREATE TABLE sms.admission_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  academic_year_id uuid REFERENCES sms.academic_years(id) ON DELETE SET NULL,
  grade_applied integer NOT NULL CHECK (grade_applied BETWEEN 0 AND 12),
  first_name text NOT NULL,
  father_name text NOT NULL,
  grandfather_name text,
  gender text CHECK (gender IN ('M', 'F')),
  date_of_birth date,
  previous_school text,
  address text,
  guardian_name text,
  guardian_phone text,
  guardian_relationship text,
  guardian_email text,
  notes text,
  status text NOT NULL DEFAULT 'applied'
    CHECK (status IN ('applied', 'interview', 'accepted', 'rejected', 'withdrawn', 'enrolled')),
  interview_on date,
  decision_note text,
  student_id uuid REFERENCES sms.students(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_admissions_school ON sms.admission_applications(school_id, status);
CREATE TRIGGER trg_admissions_touch BEFORE UPDATE ON sms.admission_applications
FOR EACH ROW EXECUTE FUNCTION sms.touch_updated_at();

-- 'enrolled' is only reached through sms.enroll_applicant, which sets this flag.
CREATE OR REPLACE FUNCTION sms.guard_admission_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'enrolled' AND (TG_OP = 'INSERT' OR OLD.status <> 'enrolled')
     AND coalesce(current_setting('sms.enrolling', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Use Enroll to admit an applicant; it creates the student record' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'enrolled' AND NEW.status <> 'enrolled' THEN
    RAISE EXCEPTION 'This applicant is already enrolled' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_admissions_status BEFORE INSERT OR UPDATE ON sms.admission_applications
FOR EACH ROW EXECUTE FUNCTION sms.guard_admission_status();

ALTER TABLE sms.admission_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins and registrars" ON sms.admission_applications FOR ALL TO authenticated
  USING (sms.manages_students(school_id)) WITH CHECK (sms.manages_students(school_id));

-- Turns an accepted application into a student: record, class enrollment and guardian.
-- A guardian email that matches an account also gives that parent access. Returns the new student's id.
CREATE OR REPLACE FUNCTION sms.enroll_applicant(_application_id uuid, _class_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE _a sms.admission_applications; _student uuid; _parent uuid;
BEGIN
  SELECT * INTO _a FROM sms.admission_applications WHERE id = _application_id FOR UPDATE;
  IF _a.id IS NULL OR NOT sms.manages_students(_a.school_id) THEN
    RAISE EXCEPTION 'Only administrators and registrars can enroll applicants' USING ERRCODE = '42501';
  END IF;
  IF _a.status <> 'accepted' THEN
    RAISE EXCEPTION 'Only accepted applications can be enrolled (this one is %)', _a.status USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sms.classes WHERE id = _class_id AND school_id = _a.school_id) THEN
    RAISE EXCEPTION 'Choose a class of this school' USING ERRCODE = '22023';
  END IF;

  INSERT INTO sms.students (school_id, first_name, father_name, grandfather_name, gender, date_of_birth,
                            previous_school, address, admission_date)
  VALUES (_a.school_id, _a.first_name, _a.father_name, _a.grandfather_name, _a.gender, _a.date_of_birth,
          _a.previous_school, _a.address, current_date)
  RETURNING id INTO _student;

  INSERT INTO sms.enrollments (school_id, class_id, student_id) VALUES (_a.school_id, _class_id, _student);

  IF nullif(trim(_a.guardian_name), '') IS NOT NULL THEN
    IF nullif(trim(_a.guardian_email), '') IS NOT NULL THEN
      SELECT id INTO _parent FROM auth.users WHERE lower(email) = lower(trim(_a.guardian_email));
    END IF;
    IF _parent IS NOT NULL THEN
      INSERT INTO sms.school_members (school_id, user_id, role, full_name, phone)
      VALUES (_a.school_id, _parent, 'parent', _a.guardian_name, _a.guardian_phone)
      ON CONFLICT (school_id, user_id, role) DO NOTHING;
    END IF;
    INSERT INTO sms.guardians (school_id, student_id, full_name, phone, relationship, user_id)
    VALUES (_a.school_id, _student, trim(_a.guardian_name), _a.guardian_phone, _a.guardian_relationship, _parent);
  END IF;

  PERFORM set_config('sms.enrolling', 'on', true);
  UPDATE sms.admission_applications SET status = 'enrolled', student_id = _student WHERE id = _application_id;
  PERFORM set_config('sms.enrolling', '', true);
  RETURN _student;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON sms.student_documents, sms.admission_applications TO authenticated;
GRANT ALL ON sms.student_documents, sms.admission_applications TO service_role;
REVOKE ALL ON FUNCTION sms.manages_students, sms.can_read_student_file, sms.can_write_student_file,
  sms.guard_admission_status, sms.enroll_applicant FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sms.manages_students, sms.can_read_student_file, sms.can_write_student_file,
  sms.enroll_applicant TO authenticated, service_role;
