// The home route. This group used to be the one that read the cookie, purely to
// pick the nav's presentation — / is the landing page whether or not you're
// signed in, so nothing below this layout branches on auth. With the bar moved
// to the root layout and each entry reading the session itself, that read had no
// remaining consumer and is gone.
//
// The route still renders dynamically, for what is now an app-wide reason rather
// than one belonging to this group: the navbar islands await the session cookie
// with no Suspense boundary above them. See app/navbar/header.tsx.
export default function PublicLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return <>{children}</>;
}
