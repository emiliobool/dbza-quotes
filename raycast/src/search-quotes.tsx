import { useMemo, useState } from "react";
import {
  Action,
  ActionPanel,
  Clipboard,
  Icon,
  List,
  Toast,
  showToast,
  Keyboard,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  attributedQuote,
  context,
  Doc,
  fmtTime,
  frameUrl,
  Index,
  lineFrameT,
  lineUrl,
  loadIndex,
  Media,
  mediaLabel,
  prefs,
  quoteText,
  runSearch,
  ytUrl,
} from "./lib";

const execFileP = promisify(execFile);

/** The frames are WebP; the macOS clipboard wants something everything can
 *  paste, so convert with sips before handing over the file. */
async function copyFrame(url: string) {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Grabbing the frame…",
  });
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`frame → ${res.status}`);
    const stem = path.join(os.tmpdir(), `dbza-frame-${Date.now()}`);
    await fs.writeFile(`${stem}.webp`, Buffer.from(await res.arrayBuffer()));
    await execFileP("sips", [
      "-s",
      "format",
      "png",
      `${stem}.webp`,
      "--out",
      `${stem}.png`,
    ]);
    await Clipboard.copy({ file: `${stem}.png` });
    toast.style = Toast.Style.Success;
    toast.title = "Frame copied";
  } catch (err) {
    toast.style = Toast.Style.Failure;
    toast.title = "Couldn't copy the frame";
    toast.message = err instanceof Error ? err.message : String(err);
  }
}

function Hit({
  doc,
  index,
  showDetail,
  toggleDetail,
  onPickSpeaker,
}: {
  doc: Doc;
  index: Index;
  showDetail: boolean;
  toggleDetail: () => void;
  onPickSpeaker: (name: string) => void;
}) {
  const { site, frames } = prefs();
  const m: Media | undefined = index.media[doc.item];
  const url = lineUrl(site, doc);
  const img = frameUrl(frames, doc.item, lineFrameT(doc));
  const yt = ytUrl(m, doc.start);

  const detail = showDetail ? (
    <List.Item.Detail
      markdown={[
        `![](${img})`,
        "",
        doc.speaker ? `**${doc.speaker}:** ${doc.text}` : doc.text,
        "",
        "---",
        "",
        ...context(index, doc).map((c) =>
          c.id === doc.id
            ? `**${c.speaker ? `${c.speaker}: ` : ""}${c.text}**`
            : `${c.speaker ? `${c.speaker}: ` : ""}${c.text}`,
        ),
      ].join("\n")}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label
            title="Episode"
            text={mediaLabel(m) || doc.item}
          />
          <List.Item.Detail.Metadata.Label
            title="Time"
            text={`${fmtTime(doc.start)} – ${fmtTime(doc.end)}`}
          />
          {doc.speaker ? (
            <List.Item.Detail.Metadata.Label
              title="Speaker"
              text={doc.speaker}
            />
          ) : null}
          <List.Item.Detail.Metadata.Link
            title="Quote page"
            target={url}
            text="open"
          />
        </List.Item.Detail.Metadata>
      }
    />
  ) : undefined;

  return (
    <List.Item
      key={doc.id}
      icon={showDetail ? undefined : { source: img }}
      title={doc.text}
      subtitle={showDetail ? undefined : doc.speaker}
      accessories={
        showDetail
          ? undefined
          : [
              { text: mediaLabel(m).replace("Episode", "Ep") },
              { text: fmtTime(doc.start) },
            ]
      }
      detail={detail}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action.OpenInBrowser title="Open Quote Page" url={url} />
            <Action.CopyToClipboard
              title="Copy Quote"
              content={quoteText(doc)}
              shortcut={{ modifiers: ["cmd"], key: "c" }}
            />
            <Action.CopyToClipboard
              title="Copy Link"
              content={url}
              shortcut={{ modifiers: ["cmd"], key: "l" }}
              icon={Icon.Link}
            />
            <Action
              title="Copy Frame"
              icon={Icon.Image}
              shortcut={{ modifiers: ["cmd"], key: "i" }}
              onAction={() => copyFrame(img)}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action.CopyToClipboard
              title="Copy Quote with Attribution"
              content={attributedQuote(doc, m)}
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
            <Action.CopyToClipboard
              title="Copy Frame URL"
              content={img}
              shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
              icon={Icon.Image}
            />
            {yt ? (
              <Action.OpenInBrowser
                title="Open on YouTube"
                url={yt}
                shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
                icon={Icon.Video}
              />
            ) : null}
            {doc.speaker ? (
              <Action
                title={`All Lines by ${doc.speaker}`}
                icon={Icon.Person}
                shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
                onAction={() => onPickSpeaker(doc.speaker)}
              />
            ) : null}
            <Action
              title={showDetail ? "Hide Preview" : "Show Preview"}
              icon={Icon.Sidebar}
              shortcut={{ modifiers: ["cmd"], key: "d" }}
              onAction={toggleDetail}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

export default function SearchQuotes() {
  const [query, setQuery] = useState("");
  const [showDetail, setShowDetail] = useState(false);
  const { data: index, isLoading, error } = usePromise(loadIndex, []);

  const hits = useMemo(
    () => (index ? runSearch(index, query) : []),
    [index, query],
  );
  const toggleDetail = () => setShowDetail((v) => !v);
  const pickSpeaker = (name: string) => setQuery(`@${name} `);

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Warning}
          title="Couldn't load the transcript index"
          description={error.message}
        />
      </List>
    );
  }

  const browsingSpeakers = !!index && !query.trim();

  return (
    <List
      isLoading={isLoading}
      searchText={query}
      onSearchTextChange={setQuery}
      filtering={false}
      throttle
      isShowingDetail={showDetail && hits.length > 0}
      searchBarPlaceholder="Search every line ever said — or “krillin: senzu”"
    >
      {browsingSpeakers ? (
        <List.Section
          title="Characters"
          subtitle={`${index.docs.length.toLocaleString()} lines`}
        >
          {index.speakers.slice(0, 20).map((s) => (
            <List.Item
              key={s.name}
              icon={Icon.Person}
              title={s.name}
              accessories={[{ text: `${s.n.toLocaleString()} lines` }]}
              actions={
                <ActionPanel>
                  <Action
                    title="Show Lines"
                    icon={Icon.List}
                    onAction={() => pickSpeaker(s.name)}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ) : (
        <List.Section
          title={hits.length ? "Lines" : undefined}
          subtitle={hits.length ? `${hits.length}` : undefined}
        >
          {hits.map((doc) => (
            <Hit
              key={doc.id}
              doc={doc}
              index={index as Index}
              showDetail={showDetail}
              toggleDetail={toggleDetail}
              onPickSpeaker={pickSpeaker}
            />
          ))}
        </List.Section>
      )}
      <List.EmptyView
        icon={Icon.MagnifyingGlass}
        title={
          isLoading
            ? "Loading every line ever said…"
            : "Nothing. Not even a senzu bean."
        }
      />
    </List>
  );
}
