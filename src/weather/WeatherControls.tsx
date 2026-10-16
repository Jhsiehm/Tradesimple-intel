import { useState } from "react";
import type { useWeather } from "./useWeather";
import { HAZARDS, LEVEL_COLOR, PLACES, stamp, type Kind, type Point } from "./model";
import "./weather.css";
type Props = {
  weather: ReturnType<typeof useWeather>;
  region: string;
  phone: boolean;
  onPoint: (p: Point) => void;
  onLive: () => void;
};
export function WeatherControls({ weather: w, region, phone, onPoint, onLive }: Props) {
  const [locationOpen, setLocationOpen] = useState(false);
  return (
    <section className="weather-controls" aria-label="Weather and hazard controls">
      <div className="weather-overview">
        <strong>WEATHER & HAZARDS</strong>
        <span>
          {w.events.length} reports · {region}
        </span>
        <button onClick={w.refresh} disabled={w.loading}>
          {w.loading ? "Refreshing…" : "Refresh"}
        </button>
        {phone ? (
          <span className="seg" role="group" aria-label="Weather layout">
            <button aria-pressed={!w.phoneMap} onClick={() => w.setPhoneMap(false)}>
              Reports
            </button>
            <button aria-pressed={w.phoneMap} onClick={() => w.setPhoneMap(true)}>
              Map
            </button>
          </span>
        ) : null}
      </div>
      <div className="weather-actions">
        <button aria-expanded={locationOpen} onClick={() => setLocationOpen(!locationOpen)}>
          Point forecast {locationOpen ? "−" : "+"}
        </button>
        <details className="weather-disclosure">
          <summary>
            Hazard layers <span>{w.kinds.length}/6</span>
          </summary>
          <div className="weather-popover">
            {(Object.entries(HAZARDS) as [Kind, string][]).map(([kind, name]) => (
              <label key={kind}>
                <input
                  type="checkbox"
                  checked={w.kinds.includes(kind)}
                  onChange={() =>
                    w.setKinds(w.kinds.includes(kind) ? w.kinds.filter((k) => k !== kind) : [...w.kinds, kind])
                  }
                />
                {name}
                <span>{w.all.filter((h) => h.kind === kind).length}</span>
              </label>
            ))}
            <p>
              Reports are filtered by event center within the selected region. Markers do not show the affected
              footprint.
            </p>
          </div>
        </details>
        <button onClick={onLive}>Cloud imagery</button>
        <details className="weather-disclosure">
          <summary>Sources & legend</summary>
          <div className="weather-popover weather-sources">
            <p>
              Weather forecasts and disaster assessments are separate products. Neither includes every local warning.
            </p>
            <div className="weather-legend">
              {Object.entries(LEVEL_COLOR).map(([level, color]) => (
                <span key={level}>
                  <i style={{ background: color }} />
                  {level}
                </span>
              ))}
            </div>
            <p>
              Marker colors reproduce provider levels. GDACS alert levels and USGS PAGER levels are different impact
              assessments. Unrated does not mean safe. Cyan marks your forecast point.
            </p>
            {w.feeds.map((f) => (
              <div key={f.id}>
                <strong>
                  {f.name} · {f.state}
                </strong>
                <p>{f.coverage}</p>
                <p>
                  Retrieved {stamp(f.fetchedAt)}
                  {f.generatedAt ? ` · generated ${stamp(f.generatedAt)}` : ""}
                </p>
                {f.error ? <p>{f.error}</p> : null}
              </div>
            ))}
            <p>
              <a href="https://api.met.no/" target="_blank" rel="noreferrer">
                MET Norway
              </a>{" "}
              · CC BY 4.0. Worldwide point forecasts, hourly cache. Model estimates, not station observations.
            </p>
            <p>
              <a href="https://www.gdacs.org/" target="_blank" rel="noreferrer">
                Global Disaster Awareness and Coordination System
              </a>{" "}
              · latest 100 reports, polled every 5 min; a separate 2-year drought / volcano search refreshes hourly.
            </p>
            <p>
              <a href="https://earthquake.usgs.gov/earthquakes/feed/v1.0/" target="_blank" rel="noreferrer">
                USGS
              </a>{" "}
              · M2.5+ earthquakes, past week, polled every 5 min.
            </p>
            <p>
              Cloud imagery is the existing GOES / Himawari weather satellite view. Forecasts and hazard markers stay
              available over any basemap.
            </p>
          </div>
        </details>
      </div>
      {locationOpen ? (
        <div className="weather-location">
          <label>
            Supply locations
            <select
              aria-label="Supply location forecast"
              value=""
              onChange={(e) => {
                const p = PLACES[Number(e.target.value)];
                if (p) onPoint(p);
              }}
            >
              <option value="" disabled>
                Choose a location…
              </option>
              {PLACES.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const lat = Number(data.get("latitude")),
                lon = Number(data.get("longitude"));
              onPoint({ lat, lon, label: `${lat.toFixed(2)}, ${lon.toFixed(2)}` });
            }}
          >
            <label>
              Latitude
              <input name="latitude" type="number" min={-90} max={90} step="any" required placeholder="−90 to 90" />
            </label>
            <label>
              Longitude
              <input
                name="longitude"
                type="number"
                min={-180}
                max={180}
                step="any"
                required
                placeholder="−180 to 180"
              />
            </label>
            <button type="submit">Get forecast</button>
          </form>
          {!phone || w.phoneMap ? (
            <button aria-pressed={w.picking} onClick={() => w.setPicking(!w.picking)}>
              {w.picking ? "Cancel map pick" : "Pick on map"}
            </button>
          ) : null}
          <p role="status">
            {w.picking
              ? "Click an empty spot on the map to load its forecast."
              : "Choose any point worldwide. Select its row for the 7-day forecast and supply context."}
          </p>
        </div>
      ) : null}
      {w.error || w.feeds.some((f) => f.state !== "ok") ? (
        <p className="weather-warning" role="status">
          {w.error
            ? "Hazard refresh failed; any retained reports may be outdated."
            : w.feeds
                .filter((f) => f.state !== "ok")
                .map((f) => `${f.name}: ${f.state}`)
                .join(" · ")}{" "}
          Missing reports are not an all-clear.
        </p>
      ) : null}
    </section>
  );
}
