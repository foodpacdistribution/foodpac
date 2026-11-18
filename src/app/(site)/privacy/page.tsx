import { LegalPage, legalMetadata } from "../legal-page";

export const generateMetadata = () => legalMetadata("privacy");

export default function PrivacyPage() {
  return <LegalPage doc="privacy" />;
}
