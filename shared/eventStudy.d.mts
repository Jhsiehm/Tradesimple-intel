import type {BacktestSignal,Bar} from './backtest.mjs';
export const EVENT_STUDY_VERSION:number;
export type EventStudySpec={from:string;to:string;before:number;after:number;sides:'buy'|'sell'|'both'};
export type EventStudyBase={signals:BacktestSignal[];bars:Record<string,Bar[]>;benchBars:Record<string,Bar[]>};
export type EventStudyReport={version:number;spec:EventStudySpec;benchmark:string;counts:{publications:number;eligiblePublications:number;candidateEvents:number;completeEvents:number;excludedEvents:number;includedPublications:number;overlappingEvents:number};exclusions:Record<string,number>;decisions:{signalId:string;symbol:string;publicDate:string;side:string;anchorDate:string|null;eventId:string|null;reason:string}[];events:{id:string;symbol:string;anchorDate:string;from:string;to:string;signalIds:string[];sides:string[];path:{offset:number;date:string;securityReturn:number;benchmarkReturn:number;abnormalReturn:number;cumulativeAbnormalReturn:number}[];car:number;buyHoldAbnormalReturn:number;overlappingEventIds:string[]}[];curve:{offset:number;n:number;meanSecurityReturn:number;meanBenchmarkReturn:number;aar:number;caar:number}[];summary:{meanCar:number;meanBuyHoldAbnormalReturn:number}|null;caveats:string[]};
export function cleanEventStudy(raw:unknown):EventStudySpec;
export function runEventStudy(input:{base:EventStudyBase;spec:EventStudySpec}):EventStudyReport;
