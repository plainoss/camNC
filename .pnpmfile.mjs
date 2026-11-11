// With the global virtual store (pnpm-workspace.yaml `virtualStoreType: global`), dependencies live outside the
// checkout, so a package can no longer reach undeclared types through the project's hidden hoist directory. These
// rules declare the type packages that many libraries import without listing, as optional peers that resolve to the
// versions the importing project already installs.

const optionalPeers = (pkg, names) => {
  for (const name of names) {
    if (pkg.name === name || pkg.dependencies?.[name] || pkg.peerDependencies?.[name]) continue;
    pkg.peerDependencies = { ...pkg.peerDependencies, [name]: '*' };
    pkg.peerDependenciesMeta = { ...pkg.peerDependenciesMeta, [name]: { optional: true } };
  }
};

const uses = (pkg, name) => Boolean(pkg.dependencies?.[name] || pkg.peerDependencies?.[name]);

function readPackage(pkg) {
  if (uses(pkg, 'react')) optionalPeers(pkg, ['@types/react']);
  if (uses(pkg, 'three')) optionalPeers(pkg, ['@types/three']);
  // HeroUI components import types from these without declaring them.
  if (pkg.name?.startsWith('@heroui/')) optionalPeers(pkg, ['tailwind-variants', '@react-types/shared']);
  return pkg;
}

export const hooks = { readPackage };
