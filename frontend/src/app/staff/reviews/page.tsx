import { StaffSurface } from "@/components/staff/StaffSurface";
export default function StaffReviewsPage() { return <StaffSurface title="Independent review queue" description="Reviewers see the single-screen evidence required by Stage 20; reviewer and author separation remains a backend gate." resource="GET /api/v1/admin/questions?filter[status]=READY_FOR_REVIEW" />; }
