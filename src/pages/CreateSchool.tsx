import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CreateSchool() {
  const { refresh, selectSchool, memberships } = useSchool();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", code: "", region: "", city: "", phone: "", year: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data: school, error } = await supabase
        .from("schools")
        .insert({
          name: form.name.trim(),
          code: form.code.trim() || null,
          region: form.region.trim() || null,
          city: form.city.trim() || null,
          phone: form.phone.trim() || null,
        })
        .select()
        .single();
      if (error) throw error;
      if (form.year.trim()) {
        const { error: yearError } = await supabase
          .from("academic_years")
          .insert({ school_id: school.id, name: form.year.trim(), is_current: true });
        if (yearError) throw yearError;
      }
      await refresh();
      selectSchool(school.id);
      toast.success(`${school.name} created`);
      navigate("/setup", { replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Register a school</CardTitle>
          <CardDescription>
            You become the school administrator. Teachers and parents get access when an administrator adds them.
            If you are a parent or teacher, ask your school to add your email instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">School name</Label>
              <Input id="name" required value={form.name} onChange={set("name")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">School code</Label>
              <Input id="code" value={form.code} onChange={set("code")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={form.phone} onChange={set("phone")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="region">Region</Label>
              <Input id="region" placeholder="Addis Ababa" value={form.region} onChange={set("region")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City / Sub-city</Label>
              <Input id="city" value={form.city} onChange={set("city")} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="year">Current academic year</Label>
              <Input id="year" placeholder="2019 E.C." value={form.year} onChange={set("year")} />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy}>Create school</Button>
              {memberships.length > 0 ? (
                <Button type="button" variant="ghost" onClick={() => navigate("/")}>Cancel</Button>
              ) : (
                <Button type="button" variant="ghost" onClick={() => navigate("/")}>Back</Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
