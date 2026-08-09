from __future__ import annotations
from collections import Counter
from statistics import median
from math import ceil


def _percentile(values, q):
    if not values: return None
    xs=sorted(values)
    if len(xs)==1: return float(xs[0])
    pos=(len(xs)-1)*q
    lo=int(pos); hi=min(lo+1,len(xs)-1); frac=pos-lo
    return float(xs[lo]*(1-frac)+xs[hi]*frac)


def _discrimination(observations, min_band_n=20):
    eligible=[o for o in observations if isinstance(o.get("mastery_before"),(int,float)) and isinstance(o.get("is_correct"),bool)]
    if len(eligible)<2*min_band_n: return None
    eligible.sort(key=lambda x: x["mastery_before"])
    band=max(min_band_n, ceil(len(eligible)*0.27))
    if 2*band>len(eligible): band=len(eligible)//2
    if band<min_band_n: return None
    bottom=eligible[:band]; top=eligible[-band:]
    p_bottom=sum(1 for o in bottom if o["is_correct"])/band
    p_top=sum(1 for o in top if o["is_correct"])/band
    return round(p_top-p_bottom,6)


def compute_question_metrics(observations, correct_option_id=None, option_ids=None, min_band_n=20):
    """Compute immutable-window item metrics from scorable answer observations.

    Expected keys: is_correct, response_ms, selected_option_id, mastery_before,
    report_flag, repeat_error_flag. Unknown/missing fields are safely ignored.
    """
    obs=[o for o in observations if isinstance(o.get("is_correct"),bool)]
    n=len(obs)
    if not n:
        return {"sample_size":0,"correct_rate":None,"median_response_ms":None,"p90_response_ms":None,"option_distribution":{},"discrimination":None,"report_rate":None,"repeat_error_rate":None}
    times=[o["response_ms"] for o in obs if isinstance(o.get("response_ms"),(int,float)) and o["response_ms"]>=0]
    selections=Counter(str(o["selected_option_id"]) for o in obs if o.get("selected_option_id") is not None)
    if option_ids:
        for option_id in option_ids:
            selections.setdefault(str(option_id), 0)
    distribution={k:round(v/n,6) for k,v in sorted(selections.items())}
    return {
      "sample_size":n,
      "correct_rate":round(sum(1 for o in obs if o["is_correct"])/n,6),
      "median_response_ms":float(median(times)) if times else None,
      "p90_response_ms":_percentile(times,.90),
      "option_distribution":distribution,
      "correct_option_id":str(correct_option_id) if correct_option_id is not None else None,
      "discrimination":_discrimination(obs,min_band_n),
      "report_rate":round(sum(1 for o in obs if o.get("report_flag") is True)/n,6),
      "repeat_error_rate":round(sum(1 for o in obs if o.get("repeat_error_flag") is True)/n,6)
    }
