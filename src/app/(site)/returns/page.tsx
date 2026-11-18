import { LegalPage, legalMetadata } from "../legal-page";

export const generateMetadata = () => legalMetadata("returns");

export default function ReturnsPage() {
  return <LegalPage doc="returns" />;
}
