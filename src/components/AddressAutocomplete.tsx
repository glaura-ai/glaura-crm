"use client";

import { useEffect, useRef, useState } from "react";

type AddressFeature = {
  properties?: {
    label?: string;
    postcode?: string;
    city?: string;
  };
  geometry?: {
    coordinates?: number[];
  };
};

type ApiAdresseResponse = {
  features?: AddressFeature[];
};

function getCoordinates(feature: AddressFeature): { lat: number; lng: number } | null {
  const lng = Number(feature.geometry?.coordinates?.[0]);
  const lat = Number(feature.geometry?.coordinates?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function AddressAutocomplete({
  defaultValue,
  defaultLat,
  defaultLng,
  inputClassName,
}: {
  defaultValue?: string | null;
  defaultLat?: number | null;
  defaultLng?: number | null;
  inputClassName: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [lat, setLat] = useState(defaultLat != null ? String(defaultLat) : "");
  const [lng, setLng] = useState(defaultLng != null ? String(defaultLng) : "");
  const [suggestions, setSuggestions] = useState<AddressFeature[]>([]);
  const [open, setOpen] = useState(false);
  const latestQuery = useRef("");

  useEffect(() => {
    const query = value.trim();
    latestQuery.current = query;

    if (query.length < 4) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`https://api-adresse.data.gouv.fr/search/?limit=5&q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`api-adresse returned ${response.status}`);

        const data = (await response.json()) as ApiAdresseResponse;
        const nextSuggestions = (data.features ?? []).filter((feature) => {
          return Boolean(feature.properties?.label?.trim() && getCoordinates(feature));
        });

        if (latestQuery.current === query) {
          setSuggestions(nextSuggestions);
          setOpen(nextSuggestions.length > 0);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSuggestions([]);
          setOpen(false);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [value]);

  function selectSuggestion(feature: AddressFeature) {
    const label = feature.properties?.label?.trim();
    const coordinates = getCoordinates(feature);
    if (!label || !coordinates) return;

    setValue(label);
    setLat(String(coordinates.lat));
    setLng(String(coordinates.lng));
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        name="address"
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          setValue(nextValue);
          setLat("");
          setLng("");
          if (nextValue.trim().length < 4) {
            setSuggestions([]);
            setOpen(false);
          }
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        className={inputClassName}
        placeholder="12 rue de Rivoli, 75004 Paris"
        autoComplete="off"
      />
      <input type="hidden" name="lat" value={lat} />
      <input type="hidden" name="lng" value={lng} />

      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-slate-300 bg-white py-1 text-sm shadow-lg"
        >
          {suggestions.map((feature) => {
            const label = feature.properties?.label?.trim();
            const coordinates = getCoordinates(feature);
            if (!label || !coordinates) return null;
            const meta = [feature.properties?.postcode, feature.properties?.city].filter(Boolean).join(" ");

            return (
              <li key={`${label}-${coordinates.lat}-${coordinates.lng}`} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left hover:bg-rose-50 focus:bg-rose-50 focus:outline-none"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectSuggestion(feature);
                  }}
                >
                  <span className="block font-medium text-slate-950">{label}</span>
                  {meta && <span className="block text-xs text-slate-500">{meta}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
