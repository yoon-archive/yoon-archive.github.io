import fs from "fs/promises";
import path from "path";
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DATABASE_ID;
const OUT = "dist";

const esc = (s="") => s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const text = (arr=[]) => arr.map(r=>r.plain_text).join("");
const inline = (arr=[]) => arr.map(r=>{
  let t = esc(r.plain_text||""); const h=r.href, a=r.annotations||{};
  if(a.code) t=`<code>${t}</code>`; if(a.bold) t=`<strong>${t}</strong>`;
  if(a.italic) t=`<em>${t}</em>`; if(a.strikethrough) t=`<s>${t}</s>`;
  if(a.underline) t=`<u>${t}</u>`; if(h) t=`<a href="${h}">${t}</a>`;
  return t;
}).join("");

const wrap = (title, body) => `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>body{max-width:720px;margin:40px auto;padding:0 16px;line-height:1.75;font-family:system-ui}
pre{background:#f6f6f7;padding:12px;overflow:auto;border-radius:8px}img{max-width:100%}
blockquote{border-left:4px solid #ddd;margin:16px 0;padding:8px 12px;color:#555;background:#fafafa}
ul,ol{padding-left:22px}</style></head><body>
<header><a href="/">← 홈</a> | <a href="/index.html">목록</a></header>
${body}
</body></html>`;

const fetchAllBlocks = async (block_id) => {
  let out=[], cursor;
  do {
    const r = await notion.blocks.children.list({ block_id, page_size: 100, start_cursor: cursor });
    out = out.concat(r.results); cursor = r.has_more ? r.next_cursor : undefined;
  } while(cursor);
  return out;
};

const renderBlocks = async (blocks) => {
  let html="", open=false, type=null;
  const openList=t=>{ if(!open){ html += t==="numbered_list_item"?"<ol>":"<ul>"; open=true; type=t; } };
  const closeList=()=>{ if(open){ html += type==="numbered_list_item"?"</ol>":"</ul>"; open=false; type=null; } };

  for(const b of blocks){
    const t=b.type, d=b[t];
    if(t==="bulleted_list_item"||t==="numbered_list_item"){
      if(!open || type!==t){ closeList(); openList(t); }
      html += `<li>${inline(d.rich_text)}</li>`; continue;
    } else closeList();

    if(t==="paragraph") html += `<p>${inline(d.rich_text)}</p>`;
    else if(t==="heading_1") html += `<h2>${inline(d.rich_text)}</h2>`;
    else if(t==="heading_2") html += `<h3>${inline(d.rich_text)}</h3>`;
    else if(t==="heading_3") html += `<h4>${inline(d.rich_text)}</h4>`;
    else if(t==="quote") html += `<blockquote>${inline(d.rich_text)}</blockquote>`;
    else if(t==="divider") html += `<hr/>`;
    else if(t==="code") html += `<pre><code>${esc(text(d.rich_text))}</code></pre>`;
  }
  closeList();
  return html;
};

const queryPublished = async () => {
  const all=[]; let cursor;
  do{
    const r = await notion.databases.query({
      database_id: DB_ID, start_cursor: cursor, page_size: 100,
      filter: { property: "Published", checkbox: { equals: true } }
    });
    all.push(...r.results); cursor = r.has_more ? r.next_cursor : undefined;
  } while(cursor);
  return all;
};

const slugOf = (page) =>
  page.properties?.Slug?.rich_text?.[0]?.plain_text ||
  (page.properties?.Title?.title?.[0]?.plain_text || "post")
    .toLowerCase().replace(/[^a-z0-9\s-]/g,"").trim().replace(/\s+/g,"-");

const writePage = async (page) => {
  const title = page.properties?.이름?.title?.[0]?.plain_text
            || page.properties?.Title?.title?.[0]?.plain_text || "Untitled";
  const url = page.properties?.PublicUrl?.url; // 노션 공개 URL
  const slug = (page.properties?.Slug?.rich_text?.[0]?.plain_text || title)
                .toLowerCase().replace(/[^a-z0-9- ]/g,"").trim().replace(/\s+/g,"-");
  await fs.mkdir("dist", { recursive: true });
  // meta refresh + fallback 링크
  const html = `<!doctype html><meta charset="utf-8">
  <title>${title}</title>
  <meta http-equiv="refresh" content="0;url=${url}">
  <a href="${url}">노션에서 보기</a>`;
  await fs.writeFile(`dist/${slug}.html`, html);
  return { title, slug, url };
};
const writeIndex = async (items) => {
  const list = items.map(p=>`<li><a href="${p.slug}.html">${esc(p.title)}</a></li>`).join("");
  await fs.writeFile(path.join(OUT, "index.html"), wrap("블로그", `<h1>블로그</h1><ul>${list}</ul>`));
};

const main = async () => {
  const pages = await queryPublished();
  const infos = [];
  for(const p of pages) infos.push(await writePage(p));
  await writeIndex(infos);
  console.log("Built:", infos.length);
};
main().catch(e=>{ console.error(e); process.exit(1); });
