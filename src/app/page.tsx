import HomePage from "./(public)/home/page";
import { HOME_METADATA } from "./(public)/home/seo";

export const metadata = HOME_METADATA;

export default function Page() {
  return <HomePage />;
}
