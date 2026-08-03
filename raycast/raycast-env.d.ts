/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Site URL - Where the quote site lives — the search index and the links come from here. */
  "site": string,
  /** Frame Store URL - Public bucket serving one WebP every 0.5s per episode. */
  "frames": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `search-quotes` command */
  export type SearchQuotes = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `search-quotes` command */
  export type SearchQuotes = {}
}

