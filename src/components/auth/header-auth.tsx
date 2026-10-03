import { getViewer } from "@/lib/auth/viewer";
import { SignInButton, UserMenu } from "@/components/auth/user-menu";

/**
 * Server-rendered authentication state for the site header.
 *
 * Rendering happens on the server from the verified provider session, so the
 * "signed in" state can never be forged from the client. The admin link is only
 * shown as a convenience — every admin route re-checks authorization
 * server-side, so hiding the link is not what protects the admin area.
 */
export async function HeaderAuth({ nextPath = "/" }: { nextPath?: string }) {
  const viewer = await getViewer();

  if (!viewer) {
    return <SignInButton nextPath={nextPath} />;
  }

  return (
    <UserMenu
      user={{
        email: viewer.email,
        fullName: viewer.fullName,
        avatarUrl: viewer.avatarUrl,
        isAdmin: viewer.isAdmin,
      }}
    />
  );
}
