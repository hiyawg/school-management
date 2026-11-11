import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useSchool } from "@/contexts/SchoolContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Shown to a signed-in account that no school has added yet: usually a teacher or parent waiting for access.
export default function NoSchool() {
  const { session, refresh, signOut } = useSchool();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  const checkAgain = async () => {
    setChecking(true);
    const schools = await refresh();
    setChecking(false);
    // On success the app switches to the school by itself; only say something if nothing changed.
    if (schools === 0) toast.info("No school has added this account yet.");
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>No school access yet</CardTitle>
          <CardDescription>
            You are signed in as <b className="text-foreground">{session?.user.email}</b>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            <b>Teachers and parents:</b> ask your school administrator to add this exact email: teachers under
            People, parents as a guardian on their child's profile. Then click <i>Check again</i>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={checkAgain} disabled={checking}>Check again</Button>
            <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
          </div>
          <div className="border-t pt-4 text-muted-foreground">
            Setting up a school for the first time?{" "}
            <button className="font-medium text-foreground underline" onClick={() => navigate("/new-school")}>
              Register a new school
            </button>{" "}
            and you become its administrator.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
