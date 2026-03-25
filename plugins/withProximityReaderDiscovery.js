const { withXcodeProject, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SWIFT_FILE = `import Foundation
import UIKit
import React
import ProximityReader

@objc(ProximityReaderDiscoveryModule)
class ProximityReaderDiscoveryModule: NSObject {

  @objc
  func constantsToExport() -> [AnyHashable : Any]! {
    return [
      "isAvailable": isProximityReaderDiscoveryAvailable()
    ]
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }

  private func isProximityReaderDiscoveryAvailable() -> Bool {
    if #available(iOS 18.0, *) {
      return true
    }
    return false
  }

  @objc
  func isAvailable(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    resolve(isProximityReaderDiscoveryAvailable())
  }

  @objc
  func showEducation(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 18.0, *) {
      Task { @MainActor in
        do {
          let discovery = ProximityReaderDiscovery()
          let content = try await discovery.content(for: .payment(.howToTap))
          guard let viewController = RCTPresentedViewController() else {
            reject("NO_VIEW_CONTROLLER", "Could not find a presented view controller", nil)
            return
          }
          try await discovery.presentContent(content, from: viewController)
          resolve(["success": true])
        } catch {
          reject("DISCOVERY_ERROR", "Failed to show education: \\(error.localizedDescription)", error)
        }
      }
    } else {
      reject("NOT_AVAILABLE", "ProximityReaderDiscovery requires iOS 18.0 or later", nil)
    }
  }

  @objc
  func checkDeviceSupport(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 18.0, *) {
      Task {
        do {
          let discovery = ProximityReaderDiscovery()
          let contentList = try await discovery.contentList
          resolve([
            "isSupported": !contentList.isEmpty,
            "iosVersion": ProcessInfo.processInfo.operatingSystemVersionString
          ])
        } catch {
          resolve([
            "isSupported": false,
            "reason": error.localizedDescription
          ])
        }
      }
    } else {
      resolve([
        "isSupported": false,
        "reason": "Requires iOS 18.0 or later"
      ])
    }
  }
}
`;

const OBJC_BRIDGE = `#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ProximityReaderDiscoveryModule, NSObject)

RCT_EXTERN_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(showEducation:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(checkDeviceSupport:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
`;

function withProximityReaderDiscovery(config) {
  // Step 1: Write the native files to the ios project directory
  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.platformProjectRoot;
      const appName = config.modRequest.projectName;
      const appDir = path.join(projectRoot, appName);

      // Ensure the app directory exists
      if (!fs.existsSync(appDir)) {
        fs.mkdirSync(appDir, { recursive: true });
      }

      // Write Swift file
      const swiftPath = path.join(appDir, 'ProximityReaderDiscoveryModule.swift');
      fs.writeFileSync(swiftPath, SWIFT_FILE);
      console.log('[ProximityReaderDiscovery] Wrote Swift module to:', swiftPath);

      // Write Obj-C bridge file
      const objcPath = path.join(appDir, 'ProximityReaderDiscoveryModule.m');
      fs.writeFileSync(objcPath, OBJC_BRIDGE);
      console.log('[ProximityReaderDiscovery] Wrote Obj-C bridge to:', objcPath);

      return config;
    },
  ]);

  // Step 2: Add the files to the Xcode project and link ProximityReader framework
  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const appName = config.modRequest.projectName;

    // Find the main group
    const mainGroup = xcodeProject.getFirstProject().firstProject.mainGroup;

    // Add Swift file to project
    const swiftFile = `${appName}/ProximityReaderDiscoveryModule.swift`;
    if (!xcodeProject.hasFile(swiftFile)) {
      xcodeProject.addSourceFile(swiftFile, null, xcodeProject.findPBXGroupKey({ name: appName }));
      console.log('[ProximityReaderDiscovery] Added Swift file to Xcode project');
    }

    // Add Obj-C file to project
    const objcFile = `${appName}/ProximityReaderDiscoveryModule.m`;
    if (!xcodeProject.hasFile(objcFile)) {
      xcodeProject.addSourceFile(objcFile, null, xcodeProject.findPBXGroupKey({ name: appName }));
      console.log('[ProximityReaderDiscovery] Added Obj-C file to Xcode project');
    }

    // Add ProximityReader.framework as a weak (optional) linked framework
    const frameworkOptions = { weak: true };
    xcodeProject.addFramework('ProximityReader.framework', frameworkOptions);
    console.log('[ProximityReaderDiscovery] Added ProximityReader.framework (weak link)');

    return config;
  });

  return config;
}

module.exports = withProximityReaderDiscovery;
