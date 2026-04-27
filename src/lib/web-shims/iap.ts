// react-native-iap is native-only. iapService.isAvailable() returns false on
// web because the require() fails — with this shim we just export empty so
// `RNIap.foo()` is never actually called (all call sites are gated by
// isAvailable()).

export default {};
