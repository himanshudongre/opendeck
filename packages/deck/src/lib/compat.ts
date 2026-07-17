/*
 * Imported before anything else: tiny runtime guards for APIs our
 * dependencies reach for that older mobile WebKit (iOS ≤ 15.3) lacks.
 * Syntax down-leveling is vite's job (build.target); this covers runtime.
 */
interface ObjectWithHasOwn {
  hasOwn?: (target: object, key: PropertyKey) => boolean;
}

const objectRef = Object as ObjectWithHasOwn;
objectRef.hasOwn ??= (target: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(target, key);

export {};
