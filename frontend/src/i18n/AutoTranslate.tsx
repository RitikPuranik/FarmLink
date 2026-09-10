"use client";

import * as React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { translateBatch } from "@/i18n/translateClient";
import { hasLetters, looksAlreadyInLanguage } from "@/i18n/scriptDetection";

/**
 * Whole-page auto-translator.
 *
 * en.json + t() only covers strings a developer remembered to wrap. This
 * component instead walks the actual rendered DOM, finds every bit of
 * visible text (and placeholder/aria-label/title attributes) that hasn't
 * been translated yet, and translates it in place — so the app is fully
 * multilingual even where a page has plain hardcoded English text, without
 * anyone needing to touch that page's code.
 *
 * How it stays safe around React:
 * - It only ever edits a Text node's `.nodeValue` or an attribute value,
 *   never adds/removes/reorders DOM nodes, so React's own reconciliation
 *   isn't confused by it.
 * - A MutationObserver watches for new text React renders later (new
 *   pages, async data) and translates that too.
 * - Every original value is remembered so switching back to English (or
 *   to a different language) restores the exact original text first,
 *   rather than compounding translations.
 *
 * Opting an element out: add `translate="no"` (a real HTML attribute) or
 * `data-i18n-skip` to any element whose text should never be sent to the
 * translation service — see the privacy note in I18nProvider's caller.
 */

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "TEXTAREA"]);
const ATTRS = ["placeholder", "aria-label", "title"];
const DEBOUNCE_MS = 200;

function isSkippable(start: Element | null): boolean {
  let el = start;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.getAttribute?.("translate") === "no" || el.hasAttribute?.("data-i18n-skip")) return true;
    el = el.parentElement;
  }
  return false;
}

export function AutoTranslate() {
  const { language } = useI18n();
  const textOriginals = React.useRef(new Map<Text, string>()).current;
  const attrOriginals = React.useRef(new Map<Element, Map<string, string>>()).current;
  const applyingRef = React.useRef(false);
  const currentLangRef = React.useRef(language);
  const scheduledRef = React.useRef<number | null>(null);

  const collectAndTranslate = React.useCallback(
    async (targetLang: string) => {
      if (typeof document === "undefined" || targetLang === "en") return;

      const newTextNodes: Text[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const text = node.nodeValue;
          if (!text || !text.trim() || !hasLetters(text)) return NodeFilter.FILTER_REJECT;
          const parent = (node as Text).parentElement;
          if (!parent || isSkippable(parent)) return NodeFilter.FILTER_REJECT;
          if (textOriginals.has(node as Text)) return NodeFilter.FILTER_REJECT;
          if (looksAlreadyInLanguage(text, targetLang)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let current: Node | null;
      while ((current = walker.nextNode())) newTextNodes.push(current as Text);

      const attrTargets: { el: Element; attr: string; text: string }[] = [];
      document.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(",")).forEach((el) => {
        if (isSkippable(el)) return;
        ATTRS.forEach((attr) => {
          const val = el.getAttribute(attr);
          if (!val || !val.trim() || !hasLetters(val)) return;
          if (attrOriginals.get(el)?.has(attr)) return;
          if (looksAlreadyInLanguage(val, targetLang)) return;
          attrTargets.push({ el, attr, text: val });
        });
      });

      if (newTextNodes.length === 0 && attrTargets.length === 0) return;

      const sourceTexts = [...newTextNodes.map((n) => n.nodeValue || ""), ...attrTargets.map((t) => t.text)];
      const translated = await translateBatch(sourceTexts, targetLang, "en");

      // If the language moved on while this batch was in flight, its
      // results are stale — drop them rather than mixing languages.
      if (currentLangRef.current !== targetLang) return;

      applyingRef.current = true;
      newTextNodes.forEach((node, i) => {
        textOriginals.set(node, node.nodeValue || "");
        node.nodeValue = translated[i] || node.nodeValue;
      });
      attrTargets.forEach((t, i) => {
        const value = translated[newTextNodes.length + i] || t.text;
        if (!attrOriginals.has(t.el)) attrOriginals.set(t.el, new Map());
        attrOriginals.get(t.el)!.set(t.attr, t.text);
        t.el.setAttribute(t.attr, value);
      });
      requestAnimationFrame(() => {
        applyingRef.current = false;
      });
    },
    [textOriginals, attrOriginals],
  );

  const revertAll = React.useCallback(() => {
    applyingRef.current = true;
    textOriginals.forEach((original, node) => {
      if (node.isConnected) node.nodeValue = original;
    });
    textOriginals.clear();
    attrOriginals.forEach((attrs, el) => {
      attrs.forEach((original, attr) => {
        if (el.isConnected) el.setAttribute(attr, original);
      });
    });
    attrOriginals.clear();
    requestAnimationFrame(() => {
      applyingRef.current = false;
    });
  }, [textOriginals, attrOriginals]);

  const scheduleTranslate = React.useCallback(
    (targetLang: string) => {
      if (scheduledRef.current) return;
      scheduledRef.current = window.setTimeout(() => {
        scheduledRef.current = null;
        collectAndTranslate(targetLang);
      }, DEBOUNCE_MS);
    },
    [collectAndTranslate],
  );

  // Language switch: undo whatever's there, then translate fresh into the
  // newly-selected language (never chain translations of translations).
  React.useEffect(() => {
    currentLangRef.current = language;
    revertAll();
    if (language !== "en") collectAndTranslate(language);
  }, [language, collectAndTranslate, revertAll]);

  // Catch text that appears later: new pages, async data, modals, etc.
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const observer = new MutationObserver(() => {
      if (applyingRef.current || currentLangRef.current === "en") return;
      scheduleTranslate(currentLangRef.current);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [scheduleTranslate]);

  return null;
}
