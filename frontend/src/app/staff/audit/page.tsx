import { StaffSurface } from "@/components/staff/StaffSurface";
export default function StaffAuditPage() { return <StaffSurface title="Audit log" description="Read append-only canonical and admin-domain audit evidence with correlation IDs." resource="GET /api/v1/admin/audit-logs" />; }
