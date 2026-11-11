-- Student information: fuller profiles, automatic student IDs, academic history and year-end promotion.
-- Run after 20261110000000_sms_core.sql.

-- Profiles -----------------------------------------------------------------

ALTER TABLE sms.students
  ADD COLUMN admission_date date DEFAULT current_date,
  ADD COLUMN address text,
  ADD COLUMN previous_school text,
  ADD COLUMN medical_notes text,
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'graduated', 'withdrawn', 'transferred_out')),
  ADD COLUMN left_on date;

-- Automatic student IDs: "<school code>-0001", or "0001" when the school has no code.
-- A typed-in ID is kept as is; numbers already taken by a typed-in ID are skipped.
ALTER TABLE sms.schools ADD COLUMN next_student_number integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION sms.assign_student_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE _n integer; _code text; _candidate text;
BEGIN
  IF nullif(trim(NEW.student_code), '') IS NOT NULL THEN
    NEW.student_code = trim(NEW.student_code);
    RETURN NEW;
  END IF;
  LOOP
    -- The row lock on the school keeps two registrations from getting the same number.
    UPDATE sms.schools SET next_student_number = next_student_number + 1
    WHERE id = NEW.school_id
    RETURNING next_student_number - 1, code INTO _n, _code;
    _candidate = coalesce(nullif(trim(_code), '') || '-', '') || lpad(_n::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM sms.students WHERE school_id = NEW.school_id AND student_code = _candidate);
  END LOOP;
  NEW.student_code = _candidate;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_students_code BEFORE INSERT ON sms.students
FOR EACH ROW EXECUTE FUNCTION sms.assign_student_code();

-- Promotion ----------------------------------------------------------------

-- The outcome of a finished year's enrollment. The enrollment stays 'active' so the old class
-- keeps its roster for attendance and gradebook history.
ALTER TABLE sms.enrollments
  ADD COLUMN result text CHECK (result IN ('promoted', 'repeated', 'graduated'));

-- Closes a year for a list of students in one transaction.
-- _decisions: [{"student_id": "...", "result": "promoted" | "repeated" | "graduated", "to_class_id": "..."}]
-- SECURITY INVOKER: row level security still applies, so only administrators can write.
-- Safe to run again: a changed decision moves the student out of the class chosen before.
CREATE OR REPLACE FUNCTION sms.promote_students(_from_year uuid, _to_year uuid, _decisions jsonb)
RETURNS integer LANGUAGE plpgsql SET search_path = sms, public AS $$
DECLARE
  _school uuid; _d jsonb; _student uuid; _result text; _to_class uuid; _left date; _count integer := 0;
BEGIN
  SELECT school_id, coalesce(ends_on, current_date) INTO _school, _left FROM sms.academic_years WHERE id = _from_year;
  IF _school IS NULL OR NOT sms.is_admin(_school) THEN
    RAISE EXCEPTION 'Only school administrators can promote students' USING ERRCODE = '42501';
  END IF;
  IF _to_year = _from_year OR NOT EXISTS (SELECT 1 FROM sms.academic_years WHERE id = _to_year AND school_id = _school) THEN
    RAISE EXCEPTION 'Choose a different academic year of the same school to promote into' USING ERRCODE = '22023';
  END IF;

  FOR _d IN SELECT * FROM jsonb_array_elements(_decisions) LOOP
    _student = (_d->>'student_id')::uuid;
    _result = _d->>'result';
    _to_class = nullif(_d->>'to_class_id', '')::uuid;

    IF _result IS NULL OR _result NOT IN ('promoted', 'repeated', 'graduated') THEN
      RAISE EXCEPTION 'Unknown outcome "%"', _result USING ERRCODE = '22023';
    END IF;
    IF _result = 'graduated' THEN
      _to_class = NULL;
    ELSIF NOT EXISTS (SELECT 1 FROM sms.classes WHERE id = _to_class AND academic_year_id = _to_year) THEN
      RAISE EXCEPTION 'Choose a class in the new year for every student who is promoted or repeats' USING ERRCODE = '22023';
    END IF;

    UPDATE sms.enrollments e SET result = _result
    FROM sms.classes c
    WHERE c.id = e.class_id AND c.academic_year_id = _from_year
      AND e.student_id = _student AND e.status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A student has no class in the year being closed' USING ERRCODE = '22023';
    END IF;

    UPDATE sms.enrollments e SET status = 'transferred'
    FROM sms.classes c
    WHERE c.id = e.class_id AND c.academic_year_id = _to_year
      AND e.student_id = _student AND e.status = 'active' AND e.class_id IS DISTINCT FROM _to_class;

    IF _result = 'graduated' THEN
      UPDATE sms.students SET status = 'graduated', left_on = _left WHERE id = _student;
    ELSE
      INSERT INTO sms.enrollments (school_id, class_id, student_id)
      VALUES (_school, _to_class, _student)
      ON CONFLICT (class_id, student_id) DO UPDATE SET status = 'active', result = NULL;
      UPDATE sms.students SET status = 'active', left_on = NULL WHERE id = _student AND status = 'graduated';
    END IF;
    _count = _count + 1;
  END LOOP;
  RETURN _count;
END $$;

-- Results and attendance summaries ------------------------------------------
-- security_invoker: each view applies the row level security of the tables underneath,
-- so parents only see their own children here too.

-- Weighted total per student, subject and term, computed like the gradebook:
-- sum of (score / max) * weight over the assessments that have a score.
CREATE VIEW sms.subject_results WITH (security_invoker = true) AS
SELECT sc.school_id, sc.student_id, cs.class_id, a.class_subject_id, cs.subject_name, a.term_id,
       round(sum(sc.score / a.max_score * a.weight), 1) AS total,
       sum(a.weight) AS weight_scored
FROM sms.scores sc
JOIN sms.assessments a ON a.id = sc.assessment_id
JOIN sms.class_subjects cs ON cs.id = a.class_subject_id
WHERE sc.score IS NOT NULL
GROUP BY sc.school_id, sc.student_id, cs.class_id, a.class_subject_id, cs.subject_name, a.term_id;

-- One row per student and class: the average of their subject totals.
CREATE VIEW sms.class_results WITH (security_invoker = true) AS
SELECT school_id, student_id, class_id,
       round(avg(total), 1) AS average,
       count(DISTINCT class_subject_id) AS subjects
FROM sms.subject_results
GROUP BY school_id, student_id, class_id;

CREATE VIEW sms.attendance_summary WITH (security_invoker = true) AS
SELECT school_id, student_id, class_id,
       count(*) FILTER (WHERE status = 'present') AS present,
       count(*) FILTER (WHERE status = 'late') AS late,
       count(*) FILTER (WHERE status = 'absent') AS absent,
       count(*) FILTER (WHERE status = 'excused') AS excused,
       count(*) AS days
FROM sms.attendance
GROUP BY school_id, student_id, class_id;

GRANT SELECT ON sms.subject_results, sms.class_results, sms.attendance_summary TO authenticated, service_role;
REVOKE ALL ON FUNCTION sms.assign_student_code, sms.promote_students FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sms.promote_students TO authenticated, service_role;
