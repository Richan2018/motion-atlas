import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import test from 'node:test';
const src=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');const ctx={};vm.createContext(ctx);vm.runInContext('function esc(s){return String(s).replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;"}[c]));} function safeUrl(s){return s;}'+src.slice(src.indexOf('function inline('),src.indexOf('function clean(')),ctx);
test('heading followed immediately by body is retained',()=>{assert.equal(ctx.markdown('### Title\n作者：A\n核验：B'),'<h3>Title</h3><p>作者：A<br>核验：B</p>');});
test('existing paragraphs and consecutive headings survive',()=>{assert.equal(ctx.markdown('## A\n\nBody\n\n### B\nMore'),'<h3>A</h3><p>Body</p><h3>B</h3><p>More</p>');});
test('HTML is escaped and CRLF normalized',()=>{assert.equal(ctx.markdown('## X\r\n<script>'),'<h3>X</h3><p>&lt;script&gt;</p>');});
