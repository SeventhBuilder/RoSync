import type { Command } from "commander";
import path from "node:path";
import {
  ensureConfigSection,
  loadConfig,
  loadConfigDocument,
  writeConfigDocument,
} from "../config/toml_parser.js";
import { ensureProjectDirectories } from "../config/toml_parser.js";
import type { PlacesSection } from "../config/types.js";
import { ensureServiceSkeletons } from "./init.js";

interface PlaceSummary {
  name: string;
  placeId: number;
  src: string;
  isDefault: boolean;
  isActive: boolean;
}

function normalizePlaceName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function slugifyPlaceName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "place"
  );
}

function nextUniqueName(baseName: string, existingNames: Iterable<string>): string {
  const names = new Set([...existingNames].map((name) => name.toLowerCase()));
  if (!names.has(baseName.toLowerCase())) {
    return baseName;
  }

  let suffix = 2;
  while (names.has(`${baseName} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}

function nextUniqueSrc(baseSrc: string, existingSrcs: Iterable<string>): string {
  const srcs = new Set([...existingSrcs].map((entry) => entry.toLowerCase()));
  if (!srcs.has(baseSrc.toLowerCase())) {
    return baseSrc;
  }

  let suffix = 2;
  while (srcs.has(`${baseSrc}-${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${baseSrc}-${suffix}`;
}

function summarizePlaces(config: PlacesSection, activeSrc: string): PlaceSummary[] {
  return Object.entries(config.entries)
    .map(([name, entry]) => ({
      name,
      placeId: entry.placeId,
      src: entry.src,
      isDefault: config.default === name,
      isActive: activeSrc === entry.src,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function resolvePlaceIdentifier(config: PlacesSection, identifier: string): PlaceSummary | null {
  const byName = Object.entries(config.entries).find(([name]) => name.toLowerCase() === identifier.trim().toLowerCase());
  if (byName) {
    return {
      name: byName[0],
      placeId: byName[1].placeId,
      src: byName[1].src,
      isDefault: config.default === byName[0],
      isActive: false,
    };
  }

  const numericId = Number(identifier);
  if (Number.isFinite(numericId)) {
    const byId = Object.entries(config.entries).find(([, entry]) => entry.placeId === numericId);
    if (byId) {
      return {
        name: byId[0],
        placeId: byId[1].placeId,
        src: byId[1].src,
        isDefault: config.default === byId[0],
        isActive: false,
      };
    }
  }

  return null;
}

export async function addPlaceConfiguration(
  startDir: string,
  placeId: number,
  requestedName?: string,
): Promise<{ name: string; src: string; created: string[] }> {
  if (!Number.isFinite(placeId) || placeId <= 0) {
    throw new Error("Place id must be a positive number.");
  }

  const { projectRoot, configPath, document } = await loadConfigDocument(startDir);
  const config = await loadConfig(startDir);
  const existing = Object.entries(config.places.entries);

  if (existing.some(([, entry]) => entry.placeId === placeId)) {
    throw new Error(`A place with id ${placeId} is already configured.`);
  }

  const baseName = normalizePlaceName(requestedName ?? `Place ${placeId}`);
  if (!baseName) {
    throw new Error("Place name cannot be empty.");
  }

  const nextName = nextUniqueName(baseName, existing.map(([name]) => name));
  const nextSrc = nextUniqueSrc(`src-${slugifyPlaceName(nextName)}`, existing.map(([, entry]) => entry.src));

  const placesSection = ensureConfigSection(document, "places");
  placesSection[nextName] = {
    place_id: placeId,
    src: nextSrc,
  };

  await writeConfigDocument(configPath, document);
  const created = await ensureServiceSkeletons(projectRoot, path.join(projectRoot, nextSrc));

  return {
    name: nextName,
    src: nextSrc,
    created,
  };
}

export async function switchPlaceConfiguration(
  startDir: string,
  identifier: string,
): Promise<{ name: string; placeId: number; src: string; created: string[] }> {
  const { configPath, document } = await loadConfigDocument(startDir);
  const config = await loadConfig(startDir);
  const resolved = resolvePlaceIdentifier(config.places, identifier);

  if (!resolved) {
    throw new Error(`No configured place matches "${identifier}".`);
  }

  const syncSection = ensureConfigSection(document, "sync");
  syncSection.src = resolved.src;

  const placesSection = ensureConfigSection(document, "places");
  placesSection.default = resolved.name;

  const projectSection = ensureConfigSection(document, "project");
  projectSection.game_id = resolved.placeId;

  await writeConfigDocument(configPath, document);

  const nextConfig = await loadConfig(startDir);
  await ensureProjectDirectories(nextConfig);
  const created = await ensureServiceSkeletons(nextConfig.projectRoot, nextConfig.srcDir);

  return {
    name: resolved.name,
    placeId: resolved.placeId,
    src: resolved.src,
    created,
  };
}

export function registerPlaceCommands(program: Command): void {
  const place = program.command("place").description("Manage multi-place RoSync projects.");

  place.command("list").description("List configured places.").action(async () => {
    const config = await loadConfig(process.cwd());
    const places = summarizePlaces(config.places, config.sync.src);

    if (places.length === 0) {
      console.log("No places are configured.");
      return;
    }

    console.log("Configured places:");
    for (const entry of places) {
      const markers = [
        entry.isDefault ? "default" : null,
        entry.isActive ? "active" : null,
      ].filter(Boolean);
      const suffix = markers.length > 0 ? ` [${markers.join(", ")}]` : "";
      console.log(`- ${entry.name}${suffix}`);
      console.log(`  id: ${entry.placeId}`);
      console.log(`  src: ${entry.src}`);
    }
  });

  place
    .command("switch")
    .description("Switch the active place.")
    .argument("<place-id>", "Place id")
    .action(async (placeId: string) => {
      const result = await switchPlaceConfiguration(process.cwd(), placeId);
      console.log(`Switched active place to ${result.name} (${result.placeId}).`);
      console.log(`Source directory: ${result.src}`);
      if (result.created.length > 0) {
        console.log(`Initialized ${result.created.length} scaffold file(s) in ${result.src}.`);
      }
    });

  place
    .command("add")
    .description("Add a place configuration.")
    .argument("<place-id>", "Place id")
    .option("--name <name>", "Optional place name")
    .action(async (placeId: string, options: { name?: string }) => {
      const numericPlaceId = Number(placeId);
      const result = await addPlaceConfiguration(process.cwd(), numericPlaceId, options.name);
      console.log(`Added place ${result.name} (${numericPlaceId}).`);
      console.log(`Source directory: ${result.src}`);
      if (result.created.length > 0) {
        console.log(`Initialized ${result.created.length} scaffold file(s) in ${result.src}.`);
      }
    });
}
