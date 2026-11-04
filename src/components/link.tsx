import NextLink from "next/link";
import type { ComponentProps, ComponentType } from "react";

type Props = ComponentProps<typeof NextLink>;
// next/link's public types are the Pages Router's; the App Router link also takes this prop.
const AppLink = NextLink as unknown as ComponentType<Props & { unstable_dynamicOnHover?: boolean }>;

/**
 * next/link that starts loading the whole destination page as soon as the pointer rests on the
 * link or a finger touches it (needs experimental.dynamicOnHover). Every page is rendered next to
 * the database in Dublin, a long round trip from Australia, so the head start hides most of it.
 * Links in view still prefetch just the loading skeleton, so nothing extra runs until there's intent.
 * Clicks are tagged "nav" so the shop's page transition can tell them from other updates.
 */
export default function Link(props: Props) {
  return <AppLink unstable_dynamicOnHover transitionTypes={["nav"]} {...props} />;
}
