import ExcelJS from 'exceljs';
import {parse} from 'csv-parse/sync';
import yauzl from 'yauzl';
import type {Cell,Sheet,Mapping,Diagnosis,Confirmation,Value,Field} from '../shared/contracts';
import {AppError,convertValue,validateValues} from './values';
const occupied=(c:Cell|undefined)=>c?.value!==null&&c?.value!==undefined&&c?.value!=='';
async function checkZip(buffer:Buffer){
 await new Promise<void>((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(error,zip)=>{
  if(error||!zip)return reject(new AppError(422,'Arquivo Excel inválido.'));
  let size=0,count=0;
  zip.on('error',()=>reject(new AppError(422,'Arquivo Excel inválido.')));
  zip.on('entry',(e:yauzl.Entry)=>{size+=e.uncompressedSize;count++;
   if(size>40*1024*1024||count>2000){zip.close();reject(new AppError(413,'Excel excede o limite de descompactação (40 MB).'));}
   else zip.readEntry();
  });zip.on('end',resolve);zip.readEntry();
 }));
}
export function proposeMapping(sheet:Sheet,headerRow?:number):Mapping{
 const candidates=sheet.rows.slice(0,30).map((row,i)=>({i,count:row.filter(occupied).length}));
 const best=candidates.reduce((a,b)=>b.count>a.count?b:a,{i:0,count:0});
 const h=headerRow??best.i+1;
 const width=Math.max(1,...sheet.rows.map(r=>r.length));
 const fields:Field[]=Array.from({length:width},(_,i)=>{
  const source=String(sheet.rows[h-1]?.[i]?.value??'');
  const values=sheet.rows.slice(h).map(r=>r[i]).filter(occupied);
  const readonly=values.some(c=>c?.formula!==undefined);
  // Identifiers remain textual. Only native Excel scalar types are inferred.
  const identifier=/(^id$|cód|cod|cpf|cnpj|cep|telefone|matrícula)/i.test(source);
  const type=identifier?'text':values.length&&values.every(c=>typeof c?.value==='number')?'number':values.length&&values.every(c=>typeof c?.value==='boolean')?'boolean':'text';
  return {id:`c${i+1}`,source,label:source.slice(0,100)||`Coluna ${i+1}`,type,required:false,readonly,options:[],currency:'BRL',group:'Informações gerais'};
 });
 return {sheetId:sheet.id,name:sheet.name.slice(0,100),role:/resumo|total|todos|painel|relatório/i.test(sheet.name)?'report':'records',headerRow:h,endRow:sheet.rows.length,startColumn:1,endColumn:width,keyField:null,titleField:fields.find(f=>/nome|produto|cliente|descrição/i.test(f.label))?.id??'c1',fields};
}
function scalar(cell:ExcelJS.Cell):Cell{
 const v=cell.value;
 if(v===null||v===undefined)return {value:null};
 if(typeof v==='object'&&('formula' in v||'sharedFormula' in v)){
  const result='result' in v?v.result:undefined;
  return {value:result instanceof Date?result.toISOString().slice(0,10):typeof result==='number'||typeof result==='boolean'||typeof result==='string'?result:null,formula:cell.formula||'[fórmula compartilhada]'};
 }
 if(v instanceof Date)return {value:v.toISOString().slice(0,10)};
 if(typeof v==='object')return {value:cell.text};
 if(typeof v==='number'&&/^0{2,}$/.test(cell.numFmt))return {value:String(v).padStart(cell.numFmt.length,'0')};
 return {value:v};
}
export async function parseFiles(files:{originalname:string;buffer:Buffer}[]):Promise<Diagnosis>{
 const sheets:Sheet[]=[];
 for(const file of files){
  if(file.buffer.length>5*1024*1024)throw new AppError(413,'Limite de 5 MB por arquivo.');
  const name=file.originalname.replaceAll('\\','/').split('/').pop()!.slice(0,200);
  if(/\.csv$/i.test(name)){
   let rows:string[][];
   try{
    const content=new TextDecoder('utf-8',{fatal:true}).decode(file.buffer);
    const first=content.split(/\r?\n/).slice(0,10).join('\n');
    const delimiter=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';
    rows=parse(content,{bom:true,delimiter,relax_column_count:true,skip_empty_lines:false,max_record_size:100000});
   }catch{throw new AppError(422,`Não foi possível ler ${name}. Use CSV UTF-8, separado por vírgula ou ponto e vírgula.`);}
   sheets.push({id:`s${sheets.length}`,file:name,name:name.replace(/\.csv$/i,''),rows:rows.map(r=>r.map(value=>({value}))),warnings:[]});
  }else if(/\.xlsx$/i.test(name)){
   await checkZip(file.buffer);
   const book=new ExcelJS.Workbook();
   try{await book.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);}catch{throw new AppError(422,`Não foi possível ler ${name}. Arquivo inválido ou protegido.`);}
   for(const ws of book.worksheets){
    if(ws.rowCount>10001||ws.columnCount>100)throw new AppError(413,'Limite de 10 mil linhas e 100 colunas por lote.');
    const rows:Cell[][]=[];
    for(let r=1;r<=ws.rowCount;r++){const row:Cell[]=[];for(let c=1;c<=ws.columnCount;c++)row.push(scalar(ws.getCell(r,c)));rows.push(row);}
    const warnings:string[]=[];
    if(ws.model.merges?.length)warnings.push('Há células mescladas. Revise a região e os valores antes de importar.');
    if(ws.state!=='visible')warnings.push('Esta aba está oculta no arquivo.');
    sheets.push({id:`s${sheets.length}`,file:name,name:ws.name,rows,warnings});
   }
  }else throw new AppError(422,'Use arquivos .xlsx ou .csv. XLS e XLSM não são suportados.');
 }
 if(!sheets.length||sheets.length>20||sheets.reduce((n,s)=>n+s.rows.length,0)>10020)throw new AppError(413,'Use até 20 abas e 10 mil linhas por lote.');
 for(const s of sheets){
  if(!s.rows.length)s.rows=[[{value:null}]];
  if(s.rows.some(r=>r.length>100||r.some(c=>typeof c.value==='string'&&c.value.length>10000)))throw new AppError(413,'Limite de 100 colunas e 10 mil caracteres por célula.');
  const m=proposeMapping(s),names=m.fields.map(f=>f.source);
  if(names.some(x=>!x))s.warnings.push('Há colunas sem nome. Defina seus rótulos.');
  if(new Set(names).size!==names.length)s.warnings.push('Cabeçalho duplicado: cada coluna será preservada separadamente.');
  if(m.headerRow>1)s.warnings.push(`${m.headerRow-1} linha(s) antes do cabeçalho sugerido. Revise sua exclusão.`);
  if(s.rows.some(r=>r.some(c=>c.formula!==undefined)))s.warnings.push('Fórmulas: apenas resultado salvo no arquivo; fotografia sem recálculo e somente leitura.');
  if(s.rows.some(r=>r.some(c=>typeof c.value==='string'&&/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(c.value))))s.warnings.push('Datas textuais: escolha o tipo e confira a localidade antes de converter.');
 }
 return {sheets,mappings:sheets.map(s=>proposeMapping(s)),warnings:['Nenhuma aba será unida automaticamente. Resumos podem duplicar registros: escolha a fonte correta.','Gráficos, tabelas dinâmicas, estilos e automações não são convertidos. Revise as regiões excluídas.']};
}
export interface Prepared {mapping:Mapping;sheet:Sheet;rows:{row:number;values:Record<string,Value>;original:Record<string,Value>}[];}
export function prepareImport(diagnosis:Diagnosis,config:Confirmation):Prepared[]{
 if(config.mappings.length!==diagnosis.sheets.length||new Set(config.mappings.map(m=>m.sheetId)).size!==diagnosis.sheets.length)throw new AppError(422,'Revise todas as abas, sem duplicações.');
 const result:Prepared[]=[];
 for(const m of config.mappings){
  const s=diagnosis.sheets.find(s=>s.id===m.sheetId);
  if(!s)throw new AppError(422,'Aba desconhecida.');
  if(m.role==='exclude'||m.role==='report')continue;
  if(m.headerRow>=m.endRow||m.endRow>s.rows.length||m.startColumn>m.endColumn)throw new AppError(422,`Região inválida em ${m.name}.`);
  const expected=Array.from({length:m.endColumn-m.startColumn+1},(_,i)=>`c${i+m.startColumn}`);
  if(m.fields.length!==expected.length||expected.some(id=>!m.fields.some(f=>f.id===id)))throw new AppError(422,'Campos não correspondem à região selecionada.');
  if(!m.fields.some(f=>f.id===m.titleField)||m.keyField&&!m.fields.some(f=>f.id===m.keyField))throw new AppError(422,'Título ou chave inválida.');
  if(m.keyField&&m.fields.find(f=>f.id===m.keyField)?.type!=='text')throw new AppError(422,'Identificadores devem ser do tipo texto.');
  const keys=new Set<string>();const rows:Prepared['rows']=[];
  for(let r=m.headerRow;r<m.endRow;r++){
   const original:Record<string,Value>={},values:Record<string,Value>={};
   if(!s.rows[r]?.slice(m.startColumn-1,m.endColumn).some(occupied))continue;
   for(const f of m.fields){
    const c=s.rows[r]?.[Number(f.id.slice(1))-1];
    if(c?.formula!==undefined&&!f.readonly)throw new AppError(422,`Fórmula em ${m.name}, linha ${r+1}: mantenha somente leitura.`);
    original[f.id]=c?.value??null;
    try{values[f.id]=convertValue(original[f.id],f,config.locale);}catch(e){throw new AppError(422,`${m.name}, linha ${r+1}: ${(e as Error).message}`);}
   }
   validateValues(values,m.fields,{},true);
   if(m.keyField){const key=String(values[m.keyField]??'');if(!key||keys.has(key))throw new AppError(422,`${m.name}, linha ${r+1}: chave vazia ou duplicada.`);keys.add(key);}
   rows.push({row:r+1,values,original});
  }
  result.push({mapping:m,sheet:s,rows});
 }
 if(!result.length||!result.some(s=>s.rows.length))throw new AppError(422,'Selecione ao menos uma tabela com registros.');
 for(const source of result)for(const f of source.mapping.fields.filter(f=>f.type==='reference')){
  const target=result.find(t=>t.mapping.sheetId===f.reference?.sheetId);
  if(!target||target.mapping.keyField!==f.reference?.fieldId)throw new AppError(422,`Configure uma chave única no destino de “${f.label}”.`);
  const keys=new Set(target.rows.map(r=>String(r.values[f.reference!.fieldId])));
  for(const r of source.rows)if(r.values[f.id]!==null&&r.values[f.id]!==''&&!keys.has(String(r.values[f.id])))throw new AppError(422,`${source.mapping.name}, linha ${r.row}: referência “${f.label}” sem correspondência.`);
 }
 return result;
}
