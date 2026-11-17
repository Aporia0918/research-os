// UI language controls (ADR-221): the Settings selector and the compact top-bar toggle share one state (i18next).
import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LANGUAGES, setLanguage, type Language } from "@/i18n";
import { isLanguage } from "@/i18n/detect";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Tip } from "@/components/ui/misc";

export function useLanguage(): Language {
  const { i18n } = useTranslation();
  return isLanguage(i18n.language) ? i18n.language : "en";
}

export function LanguageSelect() {
  const { t } = useTranslation();
  const lng = useLanguage();
  return (
    <Field label={t("language.label")} htmlFor="ui-language" hint={t("language.description")}>
      <select id="ui-language" className="h-11 w-fit jelly-field rounded-[14px] px-3" value={lng}
        onChange={(e) => { if (isLanguage(e.target.value)) setLanguage(e.target.value); }}>
        {LANGUAGES.map((l) => <option key={l} value={l} lang={l}>{t(`language.${l}`)}</option>)}
      </select>
    </Field>
  );
}

export function LanguageToggle() {
  const { t } = useTranslation();
  const next: Language = useLanguage() === "zh-CN" ? "en" : "zh-CN";
  const label = t("language.switchTo", { name: t(`language.${next}`) });
  return (
    <Tip label={label}>
      <Button variant="ghost" size="icon" aria-label={label} onClick={() => setLanguage(next)}>
        <Languages /><span className="sr-only" lang={next}>{t(`language.${next}`)}</span>
      </Button>
    </Tip>
  );
}
