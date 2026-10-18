/**
 * VS Code scrollbar — Host half.
 *
 * The plugin is a pure Client-side stylesheet: it ships no Host service, tool,
 * event or Remote, and it never touches the profile or the session store. The
 * Host row exists only so the bundle has a composition entry the loader can
 * select and the Client module (`./client`) can be injected from.
 */
export function apply() {}
