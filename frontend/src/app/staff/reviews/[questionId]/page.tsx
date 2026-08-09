import { StaffSurface } from "@/components/staff/StaffSurface";
export default function StaffReviewDetailPage() { return <StaffSurface title="Review detail" description="Approve, reject or request changes with immutable review evidence." resource="POST /api/v1/admin/questions/{questionId}/review" />; }
