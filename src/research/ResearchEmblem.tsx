import brandMark from '../assets/tradesimple-mark.svg';
import './home.css';
export function ResearchEmblem({ active = false }: {active?:boolean}) {
  return <svg className={`research-emblem ${active ? 'executing' : ''}`} viewBox="0 0 120 120" role="img" aria-label={active ? 'TradeSimple research execution active' : 'TradeSimple research emblem'}><circle className="emblem-orbit" cx="60" cy="60" r="58"/><image href={brandMark} x="7" y="7" width="106" height="106"/><circle className="emblem-dot" cx="60" cy="2" r="2"/></svg>;
}
