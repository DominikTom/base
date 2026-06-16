-- ─────────────────────────────────────────────────────────────────────
-- dim_cities + normalize_city()
-- Słownik miast PL/DE z geokoordynatami + funkcja deterministycznej
-- normalizacji, żeby Warszawa / WARSZAWA / warszawa / Warsaw rozpoznać
-- jako tę samą miejscowość i pokazać na heatmapie.
-- ─────────────────────────────────────────────────────────────────────

-- Funkcja: surowa nazwa miasta → znormalizowany slug.
-- Idempotentna, immutable — można jej używać w indeksach.
CREATE OR REPLACE FUNCTION normalize_city(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  result := trim(lower(raw));
  -- Krótkie / śmieciowe wartości — drop.
  IF length(result) < 2 OR result IN ('test', 'brak', '-', 'n/a', 'xxx', 'aaa', '.', '..', '...') THEN
    RETURN NULL;
  END IF;
  -- DE: dwuznakowe rozszerzenia (kanoniczna transliteracja).
  result := replace(result, 'ß', 'ss');
  result := replace(result, 'ä', 'ae');
  result := replace(result, 'ö', 'oe');
  result := replace(result, 'ü', 'ue');
  -- PL: jednoznakowe znaki diakrytyczne.
  result := translate(result, 'ąćęłńóśźż', 'acelnoszz');
  -- Wytnij wszystko poza [a-z0-9 \-].
  result := regexp_replace(result, '[^a-z0-9 \-]', '', 'g');
  result := regexp_replace(result, '\s+', ' ', 'g');
  result := trim(result);
  IF length(result) < 2 THEN RETURN NULL; END IF;
  RETURN result;
END;
$$;

-- Słownik miast — slug = wynik normalize_city(display_name).
-- aliases = inne formy zapisu (np. angielskie tłumaczenia)
-- — slug wpada do tej samej krotki gdy normalize_city(raw) = ANY(aliases).
CREATE TABLE IF NOT EXISTS dim_cities (
  slug         text PRIMARY KEY,
  display_name text NOT NULL,
  country      text NOT NULL CHECK (country IN ('PL', 'DE')),
  lat          numeric(8,5) NOT NULL,
  lon          numeric(8,5) NOT NULL,
  aliases      text[] NOT NULL DEFAULT '{}',
  population   integer
);

CREATE INDEX IF NOT EXISTS dim_cities_country_idx ON dim_cities(country);
CREATE INDEX IF NOT EXISTS dim_cities_aliases_gin ON dim_cities USING gin(aliases);

-- ── SEED — top miasta PL (>50k mieszk.) + top miasta DE (>200k) ──
-- Pokrycie ~90% wolumenu zamówień. Nieznormalizowane miasta (puste / wsie /
-- literówki bez wpisu) wypadają z heatmapy, ale są policzone w totalu.

-- Warszawa zostawia ślad jako alias "warsaw" (PL nazwa angielska).
-- München jako "munich" itp.

INSERT INTO dim_cities (slug, display_name, country, lat, lon, aliases, population) VALUES
-- ─ PL ─────────────────────────────────────────────────────────────────
('warszawa', 'Warszawa', 'PL', 52.22977, 21.01178, ARRAY['warsaw', 'warschau'], 1860000),
('krakow', 'Kraków', 'PL', 50.06143, 19.93658, ARRAY['cracow'], 780000),
('lodz', 'Łódź', 'PL', 51.75920, 19.45598, ARRAY['lodz'], 670000),
('wroclaw', 'Wrocław', 'PL', 51.10789, 17.03854, ARRAY['breslau'], 670000),
('poznan', 'Poznań', 'PL', 52.40692, 16.92517, ARRAY['posen'], 530000),
('gdansk', 'Gdańsk', 'PL', 54.35205, 18.64637, ARRAY['danzig'], 470000),
('szczecin', 'Szczecin', 'PL', 53.42894, 14.55302, ARRAY['stettin'], 400000),
('bydgoszcz', 'Bydgoszcz', 'PL', 53.12350, 18.00844, ARRAY[]::text[], 350000),
('lublin', 'Lublin', 'PL', 51.24645, 22.56844, ARRAY[]::text[], 335000),
('bialystok', 'Białystok', 'PL', 53.13249, 23.16886, ARRAY[]::text[], 295000),
('katowice', 'Katowice', 'PL', 50.27116, 19.03930, ARRAY[]::text[], 290000),
('gdynia', 'Gdynia', 'PL', 54.51890, 18.53053, ARRAY[]::text[], 245000),
('czestochowa', 'Częstochowa', 'PL', 50.81188, 19.12245, ARRAY[]::text[], 215000),
('radom', 'Radom', 'PL', 51.40272, 21.14938, ARRAY[]::text[], 210000),
('sosnowiec', 'Sosnowiec', 'PL', 50.28634, 19.10437, ARRAY[]::text[], 200000),
('torun', 'Toruń', 'PL', 53.01378, 18.59814, ARRAY['thorn'], 195000),
('kielce', 'Kielce', 'PL', 50.86611, 20.62826, ARRAY[]::text[], 190000),
('rzeszow', 'Rzeszów', 'PL', 50.04132, 21.99901, ARRAY[]::text[], 195000),
('gliwice', 'Gliwice', 'PL', 50.29455, 18.66860, ARRAY[]::text[], 178000),
('zabrze', 'Zabrze', 'PL', 50.32490, 18.78577, ARRAY[]::text[], 170000),
('olsztyn', 'Olsztyn', 'PL', 53.77840, 20.48010, ARRAY[]::text[], 170000),
('bielsko-biala', 'Bielsko-Biała', 'PL', 49.82245, 19.04692, ARRAY[]::text[], 170000),
('bytom', 'Bytom', 'PL', 50.34818, 18.93220, ARRAY[]::text[], 165000),
('zielona gora', 'Zielona Góra', 'PL', 51.93545, 15.50640, ARRAY[]::text[], 140000),
('rybnik', 'Rybnik', 'PL', 50.09714, 18.54166, ARRAY[]::text[], 135000),
('ruda slaska', 'Ruda Śląska', 'PL', 50.25617, 18.85587, ARRAY[]::text[], 135000),
('opole', 'Opole', 'PL', 50.67500, 17.93108, ARRAY[]::text[], 125000),
('tychy', 'Tychy', 'PL', 50.13415, 19.00257, ARRAY[]::text[], 125000),
('gorzow wielkopolski', 'Gorzów Wielkopolski', 'PL', 52.73682, 15.22852, ARRAY[]::text[], 120000),
('dabrowa gornicza', 'Dąbrowa Górnicza', 'PL', 50.32400, 19.18700, ARRAY[]::text[], 120000),
('plock', 'Płock', 'PL', 52.54684, 19.70645, ARRAY[]::text[], 115000),
('elblag', 'Elbląg', 'PL', 54.15221, 19.40884, ARRAY[]::text[], 115000),
('walbrzych', 'Wałbrzych', 'PL', 50.78475, 16.28442, ARRAY[]::text[], 110000),
('wloclawek', 'Włocławek', 'PL', 52.64818, 19.06799, ARRAY[]::text[], 108000),
('tarnow', 'Tarnów', 'PL', 50.01377, 20.98698, ARRAY[]::text[], 105000),
('chorzow', 'Chorzów', 'PL', 50.29760, 18.95402, ARRAY[]::text[], 105000),
('koszalin', 'Koszalin', 'PL', 54.19438, 16.17222, ARRAY[]::text[], 105000),
('kalisz', 'Kalisz', 'PL', 51.76712, 18.09196, ARRAY[]::text[], 100000),
('legnica', 'Legnica', 'PL', 51.20748, 16.15534, ARRAY[]::text[], 95000),
('grudziadz', 'Grudziądz', 'PL', 53.48405, 18.75363, ARRAY[]::text[], 95000),
('slupsk', 'Słupsk', 'PL', 54.46412, 17.02883, ARRAY[]::text[], 90000),
('jaworzno', 'Jaworzno', 'PL', 50.20528, 19.27498, ARRAY[]::text[], 90000),
('jastrzebie-zdroj', 'Jastrzębie-Zdrój', 'PL', 49.95210, 18.57487, ARRAY[]::text[], 88000),
('nowy sacz', 'Nowy Sącz', 'PL', 49.62518, 20.71488, ARRAY[]::text[], 85000),
('jelenia gora', 'Jelenia Góra', 'PL', 50.90290, 15.71953, ARRAY[]::text[], 80000),
('siedlce', 'Siedlce', 'PL', 52.16776, 22.29005, ARRAY[]::text[], 80000),
('myslowice', 'Mysłowice', 'PL', 50.20722, 19.13639, ARRAY[]::text[], 75000),
('konin', 'Konin', 'PL', 52.22330, 18.25117, ARRAY[]::text[], 75000),
('piotrkow trybunalski', 'Piotrków Trybunalski', 'PL', 51.40468, 19.70304, ARRAY[]::text[], 75000),
('lubin', 'Lubin', 'PL', 51.40028, 16.20156, ARRAY[]::text[], 73000),
('inowroclaw', 'Inowrocław', 'PL', 52.79822, 18.26284, ARRAY[]::text[], 73000),
('mielec', 'Mielec', 'PL', 50.28722, 21.42361, ARRAY[]::text[], 60000),
('lomza', 'Łomża', 'PL', 53.17721, 22.05927, ARRAY[]::text[], 62000),
('ostrow wielkopolski', 'Ostrów Wielkopolski', 'PL', 51.65000, 17.81667, ARRAY[]::text[], 70000),
('stalowa wola', 'Stalowa Wola', 'PL', 50.58241, 22.05293, ARRAY[]::text[], 60000),
('zamosc', 'Zamość', 'PL', 50.72313, 23.25196, ARRAY[]::text[], 62000),
('pabianice', 'Pabianice', 'PL', 51.66445, 19.35496, ARRAY[]::text[], 65000),
('przemysl', 'Przemyśl', 'PL', 49.78460, 22.76800, ARRAY[]::text[], 60000),
('pruszkow', 'Pruszków', 'PL', 52.16860, 20.81330, ARRAY[]::text[], 62000),
('sopot', 'Sopot', 'PL', 54.44181, 18.55995, ARRAY[]::text[], 36000),
('wieliczka', 'Wieliczka', 'PL', 49.98731, 20.06450, ARRAY[]::text[], 25000),
('marki', 'Marki', 'PL', 52.32083, 21.10472, ARRAY[]::text[], 35000),
-- ─ DE ─────────────────────────────────────────────────────────────────
('berlin', 'Berlin', 'DE', 52.52000, 13.40500, ARRAY[]::text[], 3760000),
('hamburg', 'Hamburg', 'DE', 53.55108, 9.99368, ARRAY[]::text[], 1900000),
('muenchen', 'München', 'DE', 48.13743, 11.57549, ARRAY['munich', 'monachium'], 1490000),
('koeln', 'Köln', 'DE', 50.93753, 6.96028, ARRAY['cologne', 'kolonia'], 1090000),
('frankfurt am main', 'Frankfurt am Main', 'DE', 50.11092, 8.68213, ARRAY['frankfurt'], 760000),
('stuttgart', 'Stuttgart', 'DE', 48.77584, 9.18293, ARRAY[]::text[], 635000),
('duesseldorf', 'Düsseldorf', 'DE', 51.22774, 6.77346, ARRAY['dusseldorf'], 620000),
('leipzig', 'Leipzig', 'DE', 51.33962, 12.37129, ARRAY['lipsk'], 605000),
('dortmund', 'Dortmund', 'DE', 51.51359, 7.46532, ARRAY[]::text[], 590000),
('essen', 'Essen', 'DE', 51.45657, 7.01228, ARRAY[]::text[], 585000),
('bremen', 'Bremen', 'DE', 53.07930, 8.80169, ARRAY[]::text[], 565000),
('dresden', 'Dresden', 'DE', 51.05041, 13.73726, ARRAY['drezno'], 560000),
('hannover', 'Hannover', 'DE', 52.37589, 9.73201, ARRAY['hanover'], 545000),
('nuernberg', 'Nürnberg', 'DE', 49.45203, 11.07675, ARRAY['nuremberg', 'norymberga'], 520000),
('duisburg', 'Duisburg', 'DE', 51.43441, 6.76233, ARRAY[]::text[], 500000),
('bochum', 'Bochum', 'DE', 51.48180, 7.21620, ARRAY[]::text[], 365000),
('wuppertal', 'Wuppertal', 'DE', 51.25627, 7.15077, ARRAY[]::text[], 355000),
('bielefeld', 'Bielefeld', 'DE', 52.03022, 8.53247, ARRAY[]::text[], 335000),
('bonn', 'Bonn', 'DE', 50.73743, 7.09821, ARRAY[]::text[], 330000),
('muenster', 'Münster', 'DE', 51.96066, 7.62613, ARRAY['munster'], 315000),
('karlsruhe', 'Karlsruhe', 'DE', 49.00689, 8.40365, ARRAY[]::text[], 310000),
('mannheim', 'Mannheim', 'DE', 49.48750, 8.46604, ARRAY[]::text[], 310000),
('augsburg', 'Augsburg', 'DE', 48.37054, 10.89779, ARRAY[]::text[], 300000),
('wiesbaden', 'Wiesbaden', 'DE', 50.08258, 8.24932, ARRAY[]::text[], 280000),
('gelsenkirchen', 'Gelsenkirchen', 'DE', 51.51775, 7.08572, ARRAY[]::text[], 260000),
('moenchengladbach', 'Mönchengladbach', 'DE', 51.18039, 6.44204, ARRAY['monchengladbach'], 261000)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  country = EXCLUDED.country,
  lat = EXCLUDED.lat,
  lon = EXCLUDED.lon,
  aliases = EXCLUDED.aliases,
  population = EXCLUDED.population;

-- ── Widok agregujący geo — używany przez /api/dashboard/widgets ───────
-- Dla każdego zamówienia próbujemy zmapować delivery_city → dim_cities
-- przez slug = normalize_city(delivery_city) LUB przez aliases zawierające
-- ten sam normalized string. Zamówienia bez dopasowania wypadają z view.
CREATE OR REPLACE VIEW v_orders_geo AS
SELECT
  o.order_id,
  o.order_date,
  o.source_shop,
  o.total_gross_pln,
  o.delivery_city AS raw_city,
  c.slug,
  c.display_name,
  c.country,
  c.lat,
  c.lon
FROM fact_orders o
JOIN dim_cities c
  ON c.slug = normalize_city(o.delivery_city)
  OR normalize_city(o.delivery_city) = ANY(c.aliases);
