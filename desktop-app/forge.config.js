const path = require('path');

const enableMacNotarize = process.env.MAC_NOTARIZE === 'true';
const enableMacSign = process.env.MAC_SIGN === 'true' || enableMacNotarize;

const entitlementsFile = path.resolve(__dirname, 'entitlements/entitlements.mac.plist');
const entitlementsInheritFile = path.resolve(__dirname, 'entitlements/entitlements.mac.inherit.plist');

const osxSign = enableMacSign
  ? {
      identity: process.env.MAC_CODESIGN_IDENTITY,
      hardenedRuntime: true,
      entitlements: entitlementsFile,
      'entitlements-inherit': entitlementsInheritFile,
      'gatekeeper-assess': false
    }
  : undefined;

const osxNotarize = enableMacNotarize
  ? (process.env.APPLE_API_KEY_PATH && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER
      ? {
          tool: 'notarytool',
          appleApiKey: process.env.APPLE_API_KEY_PATH,
          appleApiKeyId: process.env.APPLE_API_KEY_ID,
          appleApiIssuer: process.env.APPLE_API_ISSUER,
          staple: true
        }
      : (process.env.APPLE_ID && (process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD) && process.env.APPLE_TEAM_ID
          ? {
              tool: 'notarytool',
              appleId: process.env.APPLE_ID,
              appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD,
              teamId: process.env.APPLE_TEAM_ID,
              staple: true
            }
          : undefined))
  : undefined;

module.exports = {
  packagerConfig: {
    name: "SOP Automation Analyzer",
    executableName: "SOPAutomationAnalyzer",
    icon: "./assets/icon",
    asar: true,
    appBundleId: "com.l-bax.sop-automation",
    appCategoryType: "public.app-category.productivity",
    osxSign,
    osxNotarize
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "SOPAutomationAnalyzer",
        setupIcon: "./assets/icon.ico",
        loadingGif: "./assets/loading.gif",
        noMsi: true
      }
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"]
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"]
    },
    {
      name: "@electron-forge/maker-dmg",
      config: {
        format: "ULFO"
      }
    }
  ]
};
