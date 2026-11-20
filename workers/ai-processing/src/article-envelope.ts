import {collectorExactV1,collectorRecordV1} from '../../collectors/src/collector-db-contracts-v1.ts';

export function readSyntheticArticleEnvelope(text:string) {
  if (!text.startsWith('SYNTHETIC ')) throw new Error('ANALYSIS_INPUT_BINDING_INVALID');
  const original = text.slice(10);
  const envelope = collectorRecordV1(JSON.parse(original));
  collectorExactV1(envelope,['title','lead','body']);
  const {title,lead,body} = envelope;
  if (typeof title!=='string' || !title || title.length>500 || title.trim()!==title ||
      typeof lead!=='string' || lead.length>4000 || typeof body!=='string' || !body.trim() ||
      JSON.stringify({title,lead,body})!==original) throw new Error('ANALYSIS_INPUT_BINDING_INVALID');
  return {title,lead,body};
}
