import { useEffect, useState } from "react";
import { useCurrentYear, useYears } from "@/hooks/useSchoolData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FeeStructures, Invoices } from "./Billing";
import { Discounts, Expenses, Payments } from "./Money";
import Reports from "./Reports";

export default function Finance() {
  const { data: years = [] } = useYears();
  const { data: current } = useCurrentYear();
  const [yearId, setYearId] = useState<string>();
  useEffect(() => { if (!yearId && current) setYearId(current.id); }, [current, yearId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Finance</h1>
        <Select value={yearId} onValueChange={setYearId}>
          <SelectTrigger className="w-40" aria-label="Academic year"><SelectValue placeholder="Year" /></SelectTrigger>
          <SelectContent>{years.map((y) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {!yearId ? (
        <p className="text-sm text-muted-foreground">Add an academic year in School setup first.</p>
      ) : (
        <Tabs defaultValue="invoices">
          <TabsList className="flex-wrap">
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="fees">Fee structures</TabsTrigger>
            <TabsTrigger value="discounts">Scholarships</TabsTrigger>
            <TabsTrigger value="expenses">Expenses</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
          <TabsContent value="invoices"><Invoices yearId={yearId} /></TabsContent>
          <TabsContent value="payments"><Payments /></TabsContent>
          <TabsContent value="fees"><FeeStructures yearId={yearId} /></TabsContent>
          <TabsContent value="discounts"><Discounts yearId={yearId} /></TabsContent>
          <TabsContent value="expenses"><Expenses yearId={yearId} /></TabsContent>
          <TabsContent value="reports"><Reports yearId={yearId} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
