/**
 * Language picker metadata only — the code and display names of languages
 * a person can choose from. This is NOT translated UI copy: choosing one of
 * these just tells I18nProvider which target language to request from the
 * live translation client (see translateClient.ts). Adding a row here does
 * not require translating anything by hand.
 */
export interface LanguageOption {
  code: string;
  englishName: string;
  nativeName: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "en", englishName: "English", nativeName: "English" },

  // Widely used across FarmLink's primary market (India)
  { code: "hi", englishName: "Hindi", nativeName: "हिन्दी" },
  { code: "mr", englishName: "Marathi", nativeName: "मराठी" },
  { code: "bn", englishName: "Bengali", nativeName: "বাংলা" },
  { code: "gu", englishName: "Gujarati", nativeName: "ગુજરાતી" },
  { code: "ta", englishName: "Tamil", nativeName: "தமிழ்" },
  { code: "te", englishName: "Telugu", nativeName: "తెలుగు" },
  { code: "kn", englishName: "Kannada", nativeName: "ಕನ್ನಡ" },
  { code: "ml", englishName: "Malayalam", nativeName: "മലയാളം" },
  { code: "pa", englishName: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
  { code: "or", englishName: "Odia", nativeName: "ଓଡ଼ିଆ" },
  { code: "as", englishName: "Assamese", nativeName: "অসমীয়া" },
  { code: "ur", englishName: "Urdu", nativeName: "اردو" },
  { code: "sd", englishName: "Sindhi", nativeName: "سنڌي" },
  { code: "ne", englishName: "Nepali", nativeName: "नेपाली" },
  { code: "sa", englishName: "Sanskrit", nativeName: "संस्कृतम्" },
  { code: "kok", englishName: "Konkani", nativeName: "कोंकणी" },
  { code: "mai", englishName: "Maithili", nativeName: "मैथिली" },
  { code: "si", englishName: "Sinhala", nativeName: "සිංහල" },

  // Global languages
  { code: "es", englishName: "Spanish", nativeName: "Español" },
  { code: "fr", englishName: "French", nativeName: "Français" },
  { code: "de", englishName: "German", nativeName: "Deutsch" },
  { code: "pt", englishName: "Portuguese", nativeName: "Português" },
  { code: "it", englishName: "Italian", nativeName: "Italiano" },
  { code: "nl", englishName: "Dutch", nativeName: "Nederlands" },
  { code: "ru", englishName: "Russian", nativeName: "Русский" },
  { code: "uk", englishName: "Ukrainian", nativeName: "Українська" },
  { code: "pl", englishName: "Polish", nativeName: "Polski" },
  { code: "ro", englishName: "Romanian", nativeName: "Română" },
  { code: "el", englishName: "Greek", nativeName: "Ελληνικά" },
  { code: "tr", englishName: "Turkish", nativeName: "Türkçe" },
  { code: "ar", englishName: "Arabic", nativeName: "العربية" },
  { code: "fa", englishName: "Persian", nativeName: "فارسی" },
  { code: "he", englishName: "Hebrew", nativeName: "עברית" },
  { code: "sw", englishName: "Swahili", nativeName: "Kiswahili" },
  { code: "am", englishName: "Amharic", nativeName: "አማርኛ" },
  { code: "zh-CN", englishName: "Chinese (Simplified)", nativeName: "中文（简体）" },
  { code: "zh-TW", englishName: "Chinese (Traditional)", nativeName: "中文（繁體）" },
  { code: "ja", englishName: "Japanese", nativeName: "日本語" },
  { code: "ko", englishName: "Korean", nativeName: "한국어" },
  { code: "vi", englishName: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "th", englishName: "Thai", nativeName: "ไทย" },
  { code: "id", englishName: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "ms", englishName: "Malay", nativeName: "Bahasa Melayu" },
  { code: "tl", englishName: "Filipino", nativeName: "Filipino" },
  { code: "my", englishName: "Burmese", nativeName: "မြန်မာ" },
  { code: "km", englishName: "Khmer", nativeName: "ខ្មែរ" },
  { code: "sv", englishName: "Swedish", nativeName: "Svenska" },
  { code: "no", englishName: "Norwegian", nativeName: "Norsk" },
  { code: "da", englishName: "Danish", nativeName: "Dansk" },
  { code: "fi", englishName: "Finnish", nativeName: "Suomi" },
  { code: "hu", englishName: "Hungarian", nativeName: "Magyar" },
  { code: "cs", englishName: "Czech", nativeName: "Čeština" },
];
