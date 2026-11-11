-- Resource library: folders of files, links and pages for staff, shareable with colleagues and attachable to
-- homework (which is how families see them).
-- Run after 20261120000000_sms_portal.sql.

CREATE TABLE sms.resource_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES sms.resource_folders(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  shared boolean NOT NULL DEFAULT false,   -- every item inside is visible to all staff
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_folders_owner ON sms.resource_folders(school_id, owner_id);

CREATE TABLE sms.resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES sms.resource_folders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('file', 'link', 'page')),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  description text,
  url text,                 -- links
  body text,                -- pages
  storage_path text UNIQUE, -- files: <school id>/<resource id>/<file name> in the "resources" bucket
  file_name text,
  size_bytes bigint,
  subject_id uuid REFERENCES sms.subjects(id) ON DELETE SET NULL,
  grade_level integer CHECK (grade_level BETWEEN 0 AND 12),
  topic_id uuid REFERENCES sms.syllabus_topics(id) ON DELETE SET NULL,
  shared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'link' OR (url IS NOT NULL AND url ~* '^https?://')),
  CHECK (kind <> 'page' OR body IS NOT NULL),
  CHECK (kind <> 'file' OR storage_path IS NOT NULL)
);
CREATE INDEX idx_sms_resources_folder ON sms.resources(school_id, folder_id);
CREATE TRIGGER trg_resources_touch BEFORE UPDATE ON sms.resources
FOR EACH ROW EXECUTE FUNCTION sms.touch_updated_at();

CREATE TABLE sms.homework_resources (
  homework_id uuid NOT NULL REFERENCES sms.homework(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES sms.resources(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  PRIMARY KEY (homework_id, resource_id)
);

-- Who may open a resource: its owner; all staff when it or its folder is shared; and anyone who can see a
-- homework it is attached to (staff, and the families of that class).
CREATE OR REPLACE FUNCTION sms.can_read_resource(_resource_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sms.resources r LEFT JOIN sms.resource_folders f ON f.id = r.folder_id
    WHERE r.id = _resource_id
      AND (r.owner_id = auth.uid()
           OR ((r.shared OR coalesce(f.shared, false)) AND sms.is_staff(r.school_id))
           OR EXISTS (SELECT 1 FROM sms.homework_resources hr
                      WHERE hr.resource_id = r.id
                        AND (sms.is_staff(r.school_id) OR sms.is_family_of_class(sms.homework_class(hr.homework_id)))))
  )
$$;

CREATE OR REPLACE FUNCTION sms.can_read_resource_file(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (SELECT 1 FROM sms.resources r WHERE r.storage_path = _path AND sms.can_read_resource(r.id))
$$;

CREATE OR REPLACE FUNCTION sms.owns_resource_file(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (SELECT 1 FROM sms.resources r WHERE r.storage_path = _path AND r.owner_id = auth.uid())
$$;

-- A resource stays in its owner's school, and in one of the owner's own folders.
CREATE OR REPLACE FUNCTION sms.check_resource() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
BEGIN
  IF NEW.folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sms.resource_folders f WHERE f.id = NEW.folder_id AND f.school_id = NEW.school_id AND f.owner_id = NEW.owner_id) THEN
    RAISE EXCEPTION 'Choose one of your own folders' USING ERRCODE = '22023';
  END IF;
  IF NEW.kind = 'file' AND split_part(NEW.storage_path, '/', 1) <> NEW.school_id::text THEN
    RAISE EXCEPTION 'The file must be stored under this school' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_resources_check BEFORE INSERT OR UPDATE ON sms.resources
FOR EACH ROW EXECUTE FUNCTION sms.check_resource();

-- Outside the folder policies, so checking a parent folder doesn't re-enter them.
CREATE OR REPLACE FUNCTION sms.owns_folder(_folder_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT EXISTS (SELECT 1 FROM sms.resource_folders WHERE id = _folder_id AND owner_id = auth.uid())
$$;

ALTER TABLE sms.resource_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.homework_resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own or shared" ON sms.resource_folders FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR (shared AND sms.is_staff(school_id)));
CREATE POLICY "staff own folders" ON sms.resource_folders FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid() AND sms.is_staff(school_id)
              AND (parent_id IS NULL OR sms.owns_folder(parent_id)));

CREATE POLICY "who may open" ON sms.resources FOR SELECT TO authenticated USING (sms.can_read_resource(id));
CREATE POLICY "staff own resources" ON sms.resources FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid() AND sms.is_staff(school_id));

CREATE POLICY "who sees the homework" ON sms.homework_resources FOR SELECT TO authenticated
  USING (sms.is_staff(school_id) OR sms.is_family_of_class(sms.homework_class(homework_id)));
CREATE POLICY "homework's teacher attaches" ON sms.homework_resources FOR ALL TO authenticated
  USING (sms.is_admin(school_id) OR sms.teaches_homework(homework_id))
  WITH CHECK ((sms.is_admin(school_id) OR sms.teaches_homework(homework_id)) AND sms.can_read_resource(resource_id));

-- Storage: a private "resources" bucket, when Supabase Storage is present.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'Supabase Storage not found; skipping the resources bucket';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public) VALUES ('resources', 'resources', false) ON CONFLICT (id) DO NOTHING;
  EXECUTE $p$CREATE POLICY "sms resources read" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'resources' AND sms.can_read_resource_file(name))$p$;
  EXECUTE $p$CREATE POLICY "sms resources upload" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'resources' AND sms.owns_resource_file(name))$p$;
  EXECUTE $p$CREATE POLICY "sms resources delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'resources' AND sms.owns_resource_file(name))$p$;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON sms.resource_folders, sms.resources, sms.homework_resources TO authenticated;
GRANT ALL ON sms.resource_folders, sms.resources, sms.homework_resources TO service_role;
REVOKE ALL ON FUNCTION sms.can_read_resource, sms.can_read_resource_file, sms.owns_resource_file, sms.check_resource, sms.owns_folder FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sms.can_read_resource, sms.can_read_resource_file, sms.owns_resource_file, sms.owns_folder TO authenticated, service_role;
