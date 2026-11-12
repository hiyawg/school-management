-- Class events: teachers add calendar events for the classes they teach; the class's families and students
-- see them. Administrators keep whole-school events.
-- Run after 20261121000000_sms_resources.sql.

ALTER TABLE sms.school_events
  ADD COLUMN class_id uuid REFERENCES sms.classes(id) ON DELETE CASCADE,
  ADD COLUMN created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT school_events_class_not_staff_only CHECK (class_id IS NULL OR audience = 'everyone');

DROP POLICY "audience read" ON sms.school_events;
DROP POLICY "admins write" ON sms.school_events;

-- Staff see every event; everyone else sees whole-school events for everyone, and their own class's events.
CREATE POLICY "audience read" ON sms.school_events FOR SELECT TO authenticated
  USING (sms.is_staff(school_id)
         OR (audience = 'everyone' AND CASE WHEN class_id IS NULL
                                            THEN sms.has_school_role(school_id, enum_range(NULL::sms.school_role))
                                            ELSE sms.is_family_of_class(class_id) END));

-- Administrators add any event; teachers add events for a class they teach.
CREATE POLICY "admins and class teachers add" ON sms.school_events FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND (sms.is_admin(school_id) OR (class_id IS NOT NULL AND sms.teaches_class(class_id))));
CREATE POLICY "admins or creator change" ON sms.school_events FOR UPDATE TO authenticated
  USING (sms.is_admin(school_id) OR created_by = auth.uid())
  WITH CHECK (sms.is_admin(school_id) OR (created_by = auth.uid() AND class_id IS NOT NULL AND sms.teaches_class(class_id)));
CREATE POLICY "admins or creator delete" ON sms.school_events FOR DELETE TO authenticated
  USING (sms.is_admin(school_id) OR created_by = auth.uid());
