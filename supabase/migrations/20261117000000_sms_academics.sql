-- Academic management: class capacity, a school subject list, syllabus and lesson plans, exam schedules,
-- and school events for the academic calendar.
-- Run after 20261116000000_sms_performance_payroll.sql.

-- Classes --------------------------------------------------------------------

ALTER TABLE sms.classes ADD COLUMN capacity integer CHECK (capacity > 0);

-- A class with students in it can't be deleted: deleting would also delete their attendance and grades.
CREATE OR REPLACE FUNCTION sms.guard_class_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sms.enrollments WHERE class_id = OLD.id AND status = 'active') THEN
    RAISE EXCEPTION 'This class has students. Move or withdraw them before deleting it.' USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_classes_guard_delete BEFORE DELETE ON sms.classes
FOR EACH ROW EXECUTE FUNCTION sms.guard_class_delete();

-- Enrolling into a full class is refused.
CREATE OR REPLACE FUNCTION sms.check_class_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE _cap integer; _n integer;
BEGIN
  IF NEW.status <> 'active' OR (TG_OP = 'UPDATE' AND OLD.status = 'active' AND OLD.class_id = NEW.class_id) THEN
    RETURN NEW;
  END IF;
  SELECT capacity INTO _cap FROM sms.classes WHERE id = NEW.class_id;
  IF _cap IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO _n FROM sms.enrollments WHERE class_id = NEW.class_id AND status = 'active' AND id <> NEW.id;
  IF _n >= _cap THEN
    RAISE EXCEPTION 'The class is full (% students)', _cap USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_enrollments_capacity BEFORE INSERT OR UPDATE OF status, class_id ON sms.enrollments
FOR EACH ROW EXECUTE FUNCTION sms.check_class_capacity();

-- School subject list ----------------------------------------------------------
-- Subjects defined once per school and applied to classes. class_subjects keeps its own name
-- (so existing data and reports stay as they are) plus a link to the list.

CREATE TABLE sms.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  default_periods_per_week smallint CHECK (default_periods_per_week BETWEEN 0 AND 30),
  -- Education-app public.subjects.subject_id, to find its curriculum at each grade level.
  curriculum_subject_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_sms_subjects_name ON sms.subjects(school_id, lower(name));

ALTER TABLE sms.class_subjects ADD COLUMN subject_id uuid REFERENCES sms.subjects(id) ON DELETE SET NULL;

-- A class subject added by name is linked to the list entry with that name, which is created if new.
CREATE OR REPLACE FUNCTION sms.link_class_subject() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
BEGIN
  IF NEW.subject_id IS NULL THEN
    INSERT INTO sms.subjects (school_id, name) VALUES (NEW.school_id, trim(NEW.subject_name)) ON CONFLICT DO NOTHING;
    SELECT id INTO NEW.subject_id FROM sms.subjects WHERE school_id = NEW.school_id AND lower(name) = lower(trim(NEW.subject_name));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_class_subjects_link BEFORE INSERT OR UPDATE OF subject_name, subject_id ON sms.class_subjects
FOR EACH ROW EXECUTE FUNCTION sms.link_class_subject();

-- Existing class subjects become the starting list.
INSERT INTO sms.subjects (school_id, name)
SELECT DISTINCT ON (school_id, lower(subject_name)) school_id, subject_name FROM sms.class_subjects
ORDER BY school_id, lower(subject_name), subject_name
ON CONFLICT DO NOTHING;
UPDATE sms.class_subjects cs SET subject_id = s.id
FROM sms.subjects s WHERE s.school_id = cs.school_id AND lower(s.name) = lower(cs.subject_name);

-- Syllabus: units → topics per subject and grade --------------------------------
-- School-wide and reused every year. Topics may point at the learning app's topic they came from.

CREATE TABLE sms.syllabus_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES sms.subjects(id) ON DELETE CASCADE,
  grade_level integer NOT NULL CHECK (grade_level BETWEEN 0 AND 12),
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  description text,
  curriculum_unit_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_units_subject ON sms.syllabus_units(subject_id, grade_level);

CREATE TABLE sms.syllabus_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES sms.syllabus_units(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  planned_periods smallint CHECK (planned_periods BETWEEN 0 AND 200),
  curriculum_topic_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_topics_unit ON sms.syllabus_topics(unit_id);

-- A teacher of this subject at this grade (this year or any year) may edit its syllabus.
CREATE OR REPLACE FUNCTION sms.teaches_subject_grade(_subject_id uuid, _grade_level integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sms.class_subjects cs JOIN sms.classes c ON c.id = cs.class_id
    WHERE cs.subject_id = _subject_id AND c.grade_level = _grade_level AND cs.teacher_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION sms.can_edit_syllabus_unit(_unit_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sms.syllabus_units u
    WHERE u.id = _unit_id AND (sms.is_admin(u.school_id) OR sms.teaches_subject_grade(u.subject_id, u.grade_level))
  )
$$;

-- Lesson plans ------------------------------------------------------------------

CREATE TABLE sms.lesson_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  class_subject_id uuid NOT NULL REFERENCES sms.class_subjects(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES sms.syllabus_topics(id) ON DELETE SET NULL,
  planned_on date,
  title text NOT NULL,
  objectives text,
  activities text,
  homework text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'taught', 'skipped')),
  taught_on date,
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'taught' OR taught_on IS NOT NULL)
);
CREATE INDEX idx_sms_lessons_subject ON sms.lesson_plans(class_subject_id, planned_on);

-- Topics taught per class subject, against its subject's syllabus at the class's grade.
CREATE VIEW sms.syllabus_coverage WITH (security_invoker = true) AS
SELECT cs.school_id, cs.id AS class_subject_id, cs.class_id,
       count(DISTINCT t.id) AS topics,
       count(DISTINCT t.id) FILTER (WHERE EXISTS (
         SELECT 1 FROM sms.lesson_plans lp WHERE lp.class_subject_id = cs.id AND lp.topic_id = t.id AND lp.status = 'taught'
       )) AS topics_taught,
       (SELECT count(*) FROM sms.lesson_plans lp WHERE lp.class_subject_id = cs.id AND lp.status = 'taught') AS lessons_taught
FROM sms.class_subjects cs
JOIN sms.classes c ON c.id = cs.class_id
LEFT JOIN sms.syllabus_units u ON u.subject_id = cs.subject_id AND u.grade_level = c.grade_level
LEFT JOIN sms.syllabus_topics t ON t.unit_id = u.id
GROUP BY cs.school_id, cs.id, cs.class_id;

-- Exam schedules -----------------------------------------------------------------

CREATE TABLE sms.exam_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES sms.academic_years(id) ON DELETE CASCADE,
  term_id uuid REFERENCES sms.terms(id) ON DELETE SET NULL,
  name text NOT NULL,                     -- e.g. 'Semester 1 final exams'
  kind text NOT NULL DEFAULT 'final' CHECK (kind IN ('midterm', 'final', 'mock', 'other')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  published boolean NOT NULL DEFAULT false,  -- parents see published schedules only
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE sms.exam_sittings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  exam_period_id uuid NOT NULL REFERENCES sms.exam_periods(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES sms.classes(id) ON DELETE CASCADE,
  class_subject_id uuid NOT NULL REFERENCES sms.class_subjects(id) ON DELETE CASCADE,
  date date NOT NULL,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  room text,
  assessment_id uuid REFERENCES sms.assessments(id) ON DELETE SET NULL,  -- the gradebook column for its marks
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (exam_period_id, class_subject_id)
);
CREATE INDEX idx_sms_sittings_date ON sms.exam_sittings(school_id, date);

CREATE TABLE sms.exam_invigilators (
  sitting_id uuid NOT NULL REFERENCES sms.exam_sittings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  PRIMARY KEY (sitting_id, user_id)
);

-- Another sitting overlapping in time for the same class, room or invigilator. Returns a description or NULL.
CREATE OR REPLACE FUNCTION sms.sitting_clash(_sitting_id uuid, _school_id uuid, _date date, _from time, _to time,
                                             _class_id uuid, _room text, _invigilator uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT CASE
           WHEN s.class_id = _class_id THEN 'The class already has '
           WHEN _invigilator IS NOT NULL THEN 'This invigilator is already supervising '
           ELSE 'The room is already used by ' END
         || cs.subject_name || ' (' || CASE WHEN c.grade_level = 0 THEN 'KG ' ELSE 'Grade ' || c.grade_level END || c.section
         || ') from ' || to_char(s.starts_at, 'HH24:MI') || ' to ' || to_char(s.ends_at, 'HH24:MI')
  FROM sms.exam_sittings s
  JOIN sms.class_subjects cs ON cs.id = s.class_subject_id
  JOIN sms.classes c ON c.id = s.class_id
  WHERE s.school_id = _school_id AND s.id IS DISTINCT FROM _sitting_id AND s.date = _date
    AND s.starts_at < _to AND _from < s.ends_at
    AND (
      (_invigilator IS NULL AND (s.class_id = _class_id
        OR (nullif(trim(_room), '') IS NOT NULL AND lower(trim(s.room)) = lower(trim(_room)))))
      OR (_invigilator IS NOT NULL AND EXISTS (SELECT 1 FROM sms.exam_invigilators i WHERE i.sitting_id = s.id AND i.user_id = _invigilator))
    )
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION sms.check_sitting() RETURNS trigger
LANGUAGE plpgsql SET search_path = sms, public AS $$
DECLARE _p sms.exam_periods; _clash text; _inv uuid;
BEGIN
  SELECT * INTO _p FROM sms.exam_periods WHERE id = NEW.exam_period_id;
  IF _p.school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'Unknown exam period' USING ERRCODE = '22023';
  END IF;
  IF NEW.date NOT BETWEEN _p.starts_on AND _p.ends_on THEN
    RAISE EXCEPTION 'The date must be within % (% to %)', _p.name, _p.starts_on, _p.ends_on USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sms.class_subjects WHERE id = NEW.class_subject_id AND class_id = NEW.class_id) THEN
    RAISE EXCEPTION 'That subject is not taught in this class' USING ERRCODE = '22023';
  END IF;
  NEW.room = nullif(trim(NEW.room), '');
  _clash = sms.sitting_clash(NEW.id, NEW.school_id, NEW.date, NEW.starts_at, NEW.ends_at, NEW.class_id, NEW.room, NULL);
  IF _clash IS NULL AND TG_OP = 'UPDATE' THEN
    FOR _inv IN SELECT user_id FROM sms.exam_invigilators WHERE sitting_id = NEW.id LOOP
      _clash = sms.sitting_clash(NEW.id, NEW.school_id, NEW.date, NEW.starts_at, NEW.ends_at, NEW.class_id, NULL, _inv);
      EXIT WHEN _clash IS NOT NULL;
    END LOOP;
  END IF;
  IF _clash IS NOT NULL THEN
    RAISE EXCEPTION '% at that time', _clash USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_sittings_check BEFORE INSERT OR UPDATE ON sms.exam_sittings
FOR EACH ROW EXECUTE FUNCTION sms.check_sitting();

CREATE OR REPLACE FUNCTION sms.check_invigilator() RETURNS trigger
LANGUAGE plpgsql SET search_path = sms, public AS $$
DECLARE _s sms.exam_sittings; _clash text;
BEGIN
  SELECT * INTO _s FROM sms.exam_sittings WHERE id = NEW.sitting_id;
  NEW.school_id = _s.school_id;
  IF NOT EXISTS (
    SELECT 1 FROM sms.school_members WHERE school_id = _s.school_id AND user_id = NEW.user_id
      AND role IN ('school_admin', 'teacher', 'registrar')) THEN
    RAISE EXCEPTION 'Invigilators must be staff of this school' USING ERRCODE = '22023';
  END IF;
  _clash = sms.sitting_clash(_s.id, _s.school_id, _s.date, _s.starts_at, _s.ends_at, _s.class_id, NULL, NEW.user_id);
  IF _clash IS NOT NULL THEN
    RAISE EXCEPTION '% at that time', _clash USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_invigilators_check BEFORE INSERT OR UPDATE ON sms.exam_invigilators
FOR EACH ROW EXECUTE FUNCTION sms.check_invigilator();

-- Calendar events ----------------------------------------------------------------

CREATE TABLE sms.school_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'event' CHECK (kind IN ('event', 'meeting', 'deadline', 'other')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  audience text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'staff')),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX idx_sms_events_date ON sms.school_events(school_id, starts_on);

-- Access -------------------------------------------------------------------------

ALTER TABLE sms.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.syllabus_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.syllabus_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.lesson_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.exam_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.exam_sittings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.exam_invigilators ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.school_events ENABLE ROW LEVEL SECURITY;

-- Subject list and syllabus: every member reads.
CREATE POLICY "members read" ON sms.subjects FOR SELECT TO authenticated
  USING (sms.has_school_role(school_id, enum_range(NULL::sms.school_role)));
CREATE POLICY "admins write" ON sms.subjects FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));

CREATE POLICY "members read" ON sms.syllabus_units FOR SELECT TO authenticated
  USING (sms.has_school_role(school_id, enum_range(NULL::sms.school_role)));
CREATE POLICY "admins and subject teachers write" ON sms.syllabus_units FOR ALL TO authenticated
  USING (sms.is_admin(school_id) OR sms.teaches_subject_grade(subject_id, grade_level))
  WITH CHECK (sms.is_admin(school_id) OR sms.teaches_subject_grade(subject_id, grade_level));

CREATE POLICY "members read" ON sms.syllabus_topics FOR SELECT TO authenticated
  USING (sms.has_school_role(school_id, enum_range(NULL::sms.school_role)));
CREATE POLICY "admins and subject teachers write" ON sms.syllabus_topics FOR ALL TO authenticated
  USING (sms.can_edit_syllabus_unit(unit_id)) WITH CHECK (sms.can_edit_syllabus_unit(unit_id));

-- Lesson plans: staff read (supervision); the subject's teacher and administrators write.
CREATE POLICY "staff read" ON sms.lesson_plans FOR SELECT TO authenticated USING (sms.is_staff(school_id));
CREATE POLICY "admins and subject teacher write" ON sms.lesson_plans FOR ALL TO authenticated
  USING (sms.is_admin(school_id) OR sms.teaches_subject(class_subject_id))
  WITH CHECK (sms.is_admin(school_id) OR sms.teaches_subject(class_subject_id));

-- Exams: staff read everything; families read published schedules; administrators write.
CREATE POLICY "staff or published" ON sms.exam_periods FOR SELECT TO authenticated
  USING (sms.is_staff(school_id) OR (published AND sms.has_school_role(school_id, enum_range(NULL::sms.school_role))));
CREATE POLICY "admins write" ON sms.exam_periods FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));
CREATE POLICY "staff or published" ON sms.exam_sittings FOR SELECT TO authenticated
  USING (sms.is_staff(school_id) OR EXISTS (SELECT 1 FROM sms.exam_periods p WHERE p.id = exam_period_id AND p.published
         AND sms.has_school_role(p.school_id, enum_range(NULL::sms.school_role))));
CREATE POLICY "admins write" ON sms.exam_sittings FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));
CREATE POLICY "staff read" ON sms.exam_invigilators FOR SELECT TO authenticated USING (sms.is_staff(school_id));
CREATE POLICY "admins write" ON sms.exam_invigilators FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));

CREATE POLICY "audience read" ON sms.school_events FOR SELECT TO authenticated
  USING (CASE audience WHEN 'staff' THEN sms.is_staff(school_id)
              ELSE sms.has_school_role(school_id, enum_range(NULL::sms.school_role)) END);
CREATE POLICY "admins write" ON sms.school_events FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON sms.subjects, sms.syllabus_units, sms.syllabus_topics, sms.lesson_plans,
  sms.exam_periods, sms.exam_sittings, sms.exam_invigilators, sms.school_events TO authenticated;
GRANT SELECT ON sms.syllabus_coverage TO authenticated;
GRANT ALL ON sms.subjects, sms.syllabus_units, sms.syllabus_topics, sms.lesson_plans,
  sms.exam_periods, sms.exam_sittings, sms.exam_invigilators, sms.school_events TO service_role;
GRANT SELECT ON sms.syllabus_coverage TO service_role;
REVOKE ALL ON FUNCTION sms.guard_class_delete, sms.check_class_capacity, sms.link_class_subject, sms.teaches_subject_grade,
  sms.can_edit_syllabus_unit, sms.sitting_clash, sms.check_sitting, sms.check_invigilator FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sms.teaches_subject_grade, sms.can_edit_syllabus_unit, sms.sitting_clash
  TO authenticated, service_role;
