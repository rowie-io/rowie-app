/**
 * Shared validation utilities
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates an email address format
 * @param email - The email to validate
 * @returns true if the email is valid, false otherwise
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

/**
 * Validates an email, allowing empty strings
 * @param email - The email to validate (empty is considered valid)
 * @returns true if the email is valid or empty, false otherwise
 */
export function isValidEmailOrEmpty(email: string): boolean {
  if (!email.trim()) return true;
  return isValidEmail(email);
}

