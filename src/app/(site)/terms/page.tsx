import { LegalPage, legalMetadata } from "../legal-page";

export const generateMetadata = () => legalMetadata("terms");

export default function TermsPage() {
  return <LegalPage doc="terms" />;
}
