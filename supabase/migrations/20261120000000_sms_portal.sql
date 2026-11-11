-- Parent and student portal: student accounts, homework, announcements, messaging, class averages.
-- Run after 20261119000100_sms_finance.sql.

-- Student accounts ------------------------------------------------------------------
-- A student with their own login sees their own records (sms.is_guardian_of already includes students.user_id).

CREATE OR REPLACE FUNCTION sms.link_student_account(_student_id uuid, _email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE _school uuid; _user uuid; _old uuid;
BEGIN
  SELECT school_id, user_id INTO _school, _old FROM sms.students WHERE id = _student_id;
  IF _school IS NULL OR NOT sms.manages_students(_school) THEN
    RAISE EXCEPTION 'Only administrators and registrars can link student accounts' USING ERRCODE = '42501';
  END IF;
  IF nullif(trim(_email), '') IS NULL THEN
    -- Unlink.
    UPDATE sms.students SET user_id = NULL WHERE id = _student_id;
    DELETE FROM sms.school_members m WHERE m.school_id = _school AND m.user_id = _old AND m.role = 'student'
      AND NOT EXISTS (SELECT 1 FROM sms.students s WHERE s.school_id = _school AND s.user_id = _old);
    RETURN;
  END IF;
  SELECT id INTO _user FROM auth.users WHERE lower(email) = lower(trim(_email));
  IF _user IS NULL THEN
    RAISE EXCEPTION 'No account with email %. Ask the student to sign up first.', _email USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM sms.students WHERE user_id = _user AND id <> _student_id) THEN
    RAISE EXCEPTION 'That account is already linked to another student' USING ERRCODE = '23505';
  END IF;
  UPDATE sms.students SET user_id = _user WHERE id = _student_id;
  INSERT INTO sms.school_members (school_id, user_id, role, full_name)
  SELECT _school, _user, 'student', first_name || ' ' || father_name FROM sms.students WHERE id = _student_id
  ON CONFLICT (school_id, user_id, role) DO NOTHING;
END $$;

-- Families of a class: guardians (and the students themselves) of anyone actively enrolled in it.
CREATE OR REPLACE FUNCTION sms.is_family_of_class(_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sms.enrollments e
    WHERE e.class_id = _class_id AND e.status = 'active' AND sms.is_guardian_of(e.student_id)
  )
$$;

-- Homework -------------------------------------------------------------------------

CREATE TABLE sms.homework (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  class_subject_id uuid NOT NULL REFERENCES sms.class_subjects(id) ON DELETE CASCADE,
  title text NOT NULL,
  instructions text,
  assigned_on date NOT NULL DEFAULT current_date,
  due_on date,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_on IS NULL OR due_on >= assigned_on)
);
CREATE INDEX idx_sms_homework_subject ON sms.homework(class_subject_id, due_on);

CREATE TABLE sms.homework_status (
  homework_id uuid NOT NULL REFERENCES sms.homework(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES sms.students(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('done', 'late', 'missing', 'excused')),
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (homework_id, student_id)
);
CREATE TRIGGER trg_homework_status_touch BEFORE UPDATE ON sms.homework_status
FOR EACH ROW EXECUTE FUNCTION sms.touch_updated_at();

CREATE OR REPLACE FUNCTION sms.homework_class(_homework_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT cs.class_id FROM sms.homework h JOIN sms.class_subjects cs ON cs.id = h.class_subject_id WHERE h.id = _homework_id
$$;

CREATE OR REPLACE FUNCTION sms.teaches_homework(_homework_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (SELECT 1 FROM sms.homework h WHERE h.id = _homework_id AND sms.teaches_subject(h.class_subject_id))
$$;

-- Announcements -----------------------------------------------------------------------
-- audience: everyone, staff, or families (guardians and students). A class narrows it to that class's families.

CREATE TABLE sms.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  audience text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'staff', 'families')),
  class_id uuid REFERENCES sms.classes(id) ON DELETE CASCADE,
  pinned boolean NOT NULL DEFAULT false,
  author_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (class_id IS NULL OR audience <> 'staff')
);
CREATE INDEX idx_sms_announcements_school ON sms.announcements(school_id, created_at DESC);

-- Messaging ---------------------------------------------------------------------------
-- A conversation is between one staff member and the family of one student (all of its guardians, and the
-- student if they have an account). Administrators can read every conversation for safeguarding.

CREATE TABLE sms.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES sms.students(id) ON DELETE CASCADE,
  staff_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_conversations_staff ON sms.conversations(staff_user_id, last_message_at DESC);
CREATE INDEX idx_sms_conversations_student ON sms.conversations(student_id, last_message_at DESC);

CREATE TABLE sms.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES sms.conversations(id) ON DELETE CASCADE,
  sender_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (length(trim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_messages_conversation ON sms.messages(conversation_id, created_at);

CREATE TABLE sms.conversation_reads (
  conversation_id uuid NOT NULL REFERENCES sms.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE OR REPLACE FUNCTION sms.in_conversation(_conversation_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (SELECT 1 FROM sms.conversations c WHERE c.id = _conversation_id
                   AND (c.staff_user_id = auth.uid() OR sms.is_guardian_of(c.student_id)))
$$;

-- Staff a family may write to about a student: administrators, and the homeroom and subject teachers of the
-- student's current classes.
CREATE OR REPLACE FUNCTION sms.can_contact(_staff_id uuid, _student_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sms.students s JOIN sms.school_members m ON m.school_id = s.school_id
    WHERE s.id = _student_id AND m.user_id = _staff_id AND m.role = 'school_admin'
  ) OR EXISTS (
    SELECT 1 FROM sms.enrollments e
    JOIN sms.classes c ON c.id = e.class_id
    JOIN sms.academic_years y ON y.id = c.academic_year_id AND y.is_current
    LEFT JOIN sms.class_subjects cs ON cs.class_id = c.id
    WHERE e.student_id = _student_id AND e.status = 'active'
      AND (c.homeroom_teacher_id = _staff_id OR cs.teacher_id = _staff_id)
  )
$$;

-- The people a family can write to about a student, with how they relate to the child.
CREATE OR REPLACE FUNCTION sms.student_contacts(_student_id uuid)
RETURNS TABLE (user_id uuid, name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  WITH me AS (SELECT sms.is_guardian_of(_student_id) OR EXISTS (
                SELECT 1 FROM sms.students s WHERE s.id = _student_id AND sms.is_staff(s.school_id)) AS ok),
  cls AS (
    SELECT c.* FROM sms.enrollments e
    JOIN sms.classes c ON c.id = e.class_id
    JOIN sms.academic_years y ON y.id = c.academic_year_id AND y.is_current
    WHERE e.student_id = _student_id AND e.status = 'active'
  ),
  rows AS (
    SELECT cls.homeroom_teacher_id AS uid, 'Homeroom teacher' AS what FROM cls WHERE cls.homeroom_teacher_id IS NOT NULL
    UNION ALL
    SELECT cs.teacher_id, cs.subject_name FROM sms.class_subjects cs JOIN cls ON cls.id = cs.class_id WHERE cs.teacher_id IS NOT NULL
    UNION ALL
    SELECT m.user_id, 'School administration' FROM sms.school_members m JOIN sms.students s ON s.school_id = m.school_id
    WHERE s.id = _student_id AND m.role = 'school_admin'
  )
  SELECT r.uid,
         coalesce((SELECT max(m.full_name) FROM sms.school_members m JOIN sms.students s ON s.school_id = m.school_id
                   WHERE s.id = _student_id AND m.user_id = r.uid AND m.role <> 'parent'),
                  (SELECT max(m.email) FROM sms.school_members m WHERE m.user_id = r.uid), 'Staff'),
         string_agg(DISTINCT r.what, ', ')
  FROM rows r, me WHERE me.ok
  GROUP BY r.uid
$$;

CREATE OR REPLACE FUNCTION sms.bump_conversation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
BEGIN
  UPDATE sms.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  INSERT INTO sms.conversation_reads (conversation_id, user_id, last_read_at) VALUES (NEW.conversation_id, NEW.sender_id, NEW.created_at)
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_messages_bump AFTER INSERT ON sms.messages
FOR EACH ROW EXECUTE FUNCTION sms.bump_conversation();

-- The signed-in user's conversations with names and unread counts (names of staff aren't otherwise visible
-- to families). Administrators' safeguarding access is not included: this is their own inbox.
CREATE OR REPLACE FUNCTION sms.my_inbox(_school_id uuid)
RETURNS TABLE (conversation_id uuid, student_id uuid, student_name text, staff_user_id uuid, staff_name text,
               subject text, last_message_at timestamptz, last_message text, unread integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT c.id, c.student_id, s.first_name || ' ' || s.father_name, c.staff_user_id,
         coalesce((SELECT max(m.full_name) FROM sms.school_members m WHERE m.school_id = c.school_id AND m.user_id = c.staff_user_id AND m.role <> 'parent'),
                  (SELECT max(m.email) FROM sms.school_members m WHERE m.user_id = c.staff_user_id), 'Staff'),
         c.subject, c.last_message_at,
         (SELECT body FROM sms.messages x WHERE x.conversation_id = c.id ORDER BY x.created_at DESC LIMIT 1),
         (SELECT count(*)::integer FROM sms.messages x WHERE x.conversation_id = c.id AND x.sender_id IS DISTINCT FROM auth.uid()
            AND x.created_at > coalesce((SELECT r.last_read_at FROM sms.conversation_reads r WHERE r.conversation_id = c.id AND r.user_id = auth.uid()), '-infinity'))
  FROM sms.conversations c JOIN sms.students s ON s.id = c.student_id
  WHERE c.school_id = _school_id AND (c.staff_user_id = auth.uid() OR sms.is_guardian_of(c.student_id))
  ORDER BY c.last_message_at DESC
$$;

-- Who wrote each message, by name, for everyone in the conversation.
CREATE OR REPLACE FUNCTION sms.conversation_people(_conversation_id uuid)
RETURNS TABLE (user_id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT DISTINCT x.sender_id,
         coalesce((SELECT max(m.full_name) FROM sms.school_members m WHERE m.school_id = c.school_id AND m.user_id = x.sender_id AND m.role <> 'student'),
                  (SELECT max(g.full_name) FROM sms.guardians g WHERE g.student_id = c.student_id AND g.user_id = x.sender_id),
                  (SELECT max(m.email) FROM sms.school_members m WHERE m.user_id = x.sender_id), 'Someone')
  FROM sms.messages x JOIN sms.conversations c ON c.id = x.conversation_id
  WHERE x.conversation_id = _conversation_id AND (sms.in_conversation(_conversation_id) OR sms.is_admin(c.school_id))
$$;

-- Class averages ------------------------------------------------------------------------
-- A student's subject totals next to their class's average, without revealing any other child's marks.

CREATE OR REPLACE FUNCTION sms.student_vs_class(_student_id uuid)
RETURNS TABLE (class_id uuid, class_subject_id uuid, subject_name text, term_id uuid, student_total numeric, class_average numeric, students integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT r.class_id, r.class_subject_id, r.subject_name, r.term_id,
         max(r.total) FILTER (WHERE r.student_id = _student_id),
         round(avg(r.total), 1),
         count(*)::integer
  FROM sms.subject_results r
  WHERE r.class_id IN (SELECT e.class_id FROM sms.enrollments e WHERE e.student_id = _student_id)
    AND (sms.is_guardian_of(_student_id) OR EXISTS (SELECT 1 FROM sms.students s WHERE s.id = _student_id AND sms.is_staff(s.school_id)))
  GROUP BY r.class_id, r.class_subject_id, r.subject_name, r.term_id
  HAVING bool_or(r.student_id = _student_id)
$$;

-- Access ---------------------------------------------------------------------------------

ALTER TABLE sms.homework ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.homework_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.conversation_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff or class families read" ON sms.homework FOR SELECT TO authenticated
  USING (sms.is_staff(school_id) OR sms.is_family_of_class((SELECT class_id FROM sms.class_subjects WHERE id = class_subject_id)));
CREATE POLICY "admins and subject teacher write" ON sms.homework FOR ALL TO authenticated
  USING (sms.is_admin(school_id) OR sms.teaches_subject(class_subject_id))
  WITH CHECK (sms.is_admin(school_id) OR sms.teaches_subject(class_subject_id));

CREATE POLICY "staff or family read" ON sms.homework_status FOR SELECT TO authenticated
  USING (sms.is_staff(school_id) OR sms.is_guardian_of(student_id));
CREATE POLICY "admins and subject teacher write" ON sms.homework_status FOR ALL TO authenticated
  USING (sms.is_admin(school_id) OR sms.teaches_homework(homework_id))
  WITH CHECK (sms.is_admin(school_id) OR sms.teaches_homework(homework_id));

CREATE POLICY "audience read" ON sms.announcements FOR SELECT TO authenticated
  USING (sms.is_staff(school_id)
         OR (audience IN ('everyone', 'families')
             AND (CASE WHEN class_id IS NULL
                       THEN sms.has_school_role(school_id, ARRAY['parent', 'student']::sms.school_role[])
                       ELSE sms.is_family_of_class(class_id) END)));
-- Administrators post anything; teachers post to the families of a class they teach.
CREATE POLICY "admins and class teachers post" ON sms.announcements FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND (sms.is_admin(school_id) OR (class_id IS NOT NULL AND sms.teaches_class(class_id))));
CREATE POLICY "admins or author change" ON sms.announcements FOR UPDATE TO authenticated
  USING (sms.is_admin(school_id) OR author_id = auth.uid())
  WITH CHECK (sms.is_admin(school_id) OR (author_id = auth.uid() AND class_id IS NOT NULL AND sms.teaches_class(class_id)));
CREATE POLICY "admins or author delete" ON sms.announcements FOR DELETE TO authenticated
  USING (sms.is_admin(school_id) OR author_id = auth.uid());

CREATE POLICY "participants and admins read" ON sms.conversations FOR SELECT TO authenticated
  USING (staff_user_id = auth.uid() OR sms.is_guardian_of(student_id) OR sms.is_admin(school_id));
CREATE POLICY "start a conversation" ON sms.conversations FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid()
              AND EXISTS (SELECT 1 FROM sms.students s WHERE s.id = student_id AND s.school_id = conversations.school_id)
              AND ((sms.is_guardian_of(student_id) AND sms.can_contact(staff_user_id, student_id))
                   OR (staff_user_id = auth.uid() AND sms.is_staff(school_id))));

CREATE POLICY "participants and admins read" ON sms.messages FOR SELECT TO authenticated
  USING (sms.in_conversation(conversation_id) OR sms.is_admin(school_id));
CREATE POLICY "participants write" ON sms.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND sms.in_conversation(conversation_id)
              AND school_id = (SELECT c.school_id FROM sms.conversations c WHERE c.id = conversation_id));

CREATE POLICY "own read markers" ON sms.conversation_reads FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND sms.in_conversation(conversation_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON sms.homework, sms.homework_status, sms.announcements, sms.conversation_reads TO authenticated;
GRANT SELECT, INSERT ON sms.conversations, sms.messages TO authenticated;
GRANT ALL ON sms.homework, sms.homework_status, sms.announcements, sms.conversations, sms.messages, sms.conversation_reads TO service_role;
REVOKE ALL ON FUNCTION sms.link_student_account, sms.is_family_of_class, sms.homework_class, sms.teaches_homework,
  sms.in_conversation, sms.can_contact, sms.student_contacts, sms.bump_conversation, sms.my_inbox, sms.conversation_people,
  sms.student_vs_class FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sms.link_student_account, sms.is_family_of_class, sms.homework_class, sms.teaches_homework,
  sms.in_conversation, sms.can_contact, sms.student_contacts, sms.my_inbox, sms.conversation_people, sms.student_vs_class
  TO authenticated, service_role;
