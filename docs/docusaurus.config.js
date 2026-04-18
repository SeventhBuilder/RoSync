module.exports = {
  title: "RoSync",
  tagline: "Two-way Roblox Studio and VS Code sync",
  url: "https://rosync.dev",
  baseUrl: "/",
  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",
  favicon: "img/favicon.ico",
  organizationName: "rosync",
  projectName: "rosync",
  presets: [
    [
      "classic",
      {
        docs: {
          path: "docs",
          routeBasePath: "/",
          sidebarPath: require.resolve("./sidebars.js")
        },
        blog: false,
        pages: false
      }
    ]
  ]
};
