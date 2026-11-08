"""Answer generation and RAGAS scoring (ticket 6), kept apart from the deterministic
retrieval metrics in evaluation.benchmark.

Generation mirrors the production chat Turn's grounded answer step: the system prompt is
GROUNDED_PROMPT read from awesome-chat-service/turn.py, the retrieved chunks are numbered
"[n] breadcrumb\\ncontent" exactly as build_messages numbers them, and the model and
reasoning effort come from awesome-chat-service/config.py (CHAT_MODEL /
CHAT_REASONING_EFFORT, so a run follows whatever production is configured to use).

RAGAS metrics, each reported on its own:
- context_precision (ContextPrecisionWithReference): are the retrieved contexts useful
  for reaching the reference answer, and ranked early? Inputs: question, reference
  answer, contexts. A case without a reference answer records an error, not a score.
- faithfulness: are the answer's claims supported by the retrieved contexts?
  Inputs: question, answer, contexts.
- response_relevancy (AnswerRelevancy): does the answer address the question?
  Inputs: question, answer; uses the judge and an embedding model.

The judge differs from the generator so the model never grades its own answers, and the
judge, embedding model, temperature and ragas version are pinned in JUDGE_CONFIG and
saved with every run. A metric that fails for a case (judge error, missing input) is
recorded in that case's `errors` and left out of the average; the error count is
reported beside it so a scoring failure cannot pass for a low score.
"""

import ast
import asyncio
import importlib.util
import math
import random
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHAT_SERVICE = ROOT / "awesome-chat-service"

JUDGE_CONFIG = {
    "judge_model": "gpt-4.1-mini-2025-04-14",
    "judge_temperature": 0.0,
    "embedding_model": "text-embedding-3-small",
    "ragas_version": "0.4.3",
}
RAGAS_METRICS = ("context_precision", "faithfulness", "response_relevancy")
METRIC_INPUTS = {
    "context_precision": ("user_input", "reference", "retrieved_contexts"),
    "faithfulness": ("user_input", "response", "retrieved_contexts"),
    "response_relevancy": ("user_input", "response"),
}


# ---------------------------------------------------------------------------
# Generation (mirrors the production Turn)
# ---------------------------------------------------------------------------
def production_prompt(turn_path=CHAT_SERVICE / "turn.py", name="GROUNDED_PROMPT"):
    """Read a prompt constant from the chat service source without importing it."""
    for node in ast.parse(Path(turn_path).read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == name for t in node.targets):
            return ast.literal_eval(node.value)
    raise ValueError(f"{name} not found in {turn_path}")


def production_generation_config(config_path=CHAT_SERVICE / "config.py"):
    spec = importlib.util.spec_from_file_location("_chat_service_config", config_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {"model": module.chat_model(), "reasoning_effort": module.chat_reasoning_effort(),
            "top_k": module.retrieval_top_k()}


def answer_messages(question, chunks, prompt):
    """The grounded Turn's messages, numbered as build_messages numbers them."""
    excerpts = "\n\n".join(
        f"[{i}] {chunk.get('breadcrumb', '')}\n{chunk['content']}" for i, chunk in enumerate(chunks, start=1)
    ) or "(no matching excerpts)"
    return [{"role": "system", "content": prompt},
            {"role": "user", "content": f"Excerpts:\n{excerpts}\n\nQuestion: {question}"}]


def openai_generator(client, model, reasoning_effort):
    async def generate(messages):
        response = await client.chat.completions.create(model=model, messages=messages,
                                                        reasoning_effort=reasoning_effort)
        return response.choices[0].message.content or ""

    return generate


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def ragas_scorers(client):
    """The three pinned RAGAS metrics as {name: async fn(**inputs) -> float}."""
    import ragas
    from ragas.embeddings import OpenAIEmbeddings
    from ragas.llms import llm_factory
    from ragas.metrics.collections import AnswerRelevancy, ContextPrecisionWithReference, Faithfulness

    if ragas.__version__ != JUDGE_CONFIG["ragas_version"]:
        raise RuntimeError(f"ragas {JUDGE_CONFIG['ragas_version']} is pinned, found {ragas.__version__}")
    llm = llm_factory(JUDGE_CONFIG["judge_model"], client=client, temperature=JUDGE_CONFIG["judge_temperature"])
    embeddings = OpenAIEmbeddings(client=client, model=JUDGE_CONFIG["embedding_model"])
    metrics = {"context_precision": ContextPrecisionWithReference(llm=llm),
               "faithfulness": Faithfulness(llm=llm),
               "response_relevancy": AnswerRelevancy(llm=llm, embeddings=embeddings)}

    def wrap(metric):
        async def scorer(**inputs):
            return (await metric.ascore(**inputs)).value

        return scorer

    return {name: wrap(metric) for name, metric in metrics.items()}


async def score_answer(inputs, scorers):
    """Run every scorer on one answer; failures and missing inputs land in `errors`."""
    scores, errors = {}, {}
    for name, scorer in scorers.items():
        required = METRIC_INPUTS[name]
        missing = [field for field in required if inputs.get(field) in (None, "", [])]
        if missing:
            errors[name] = "Missing input: " + ", ".join(missing)
            continue
        try:
            value = float(await scorer(**{field: inputs[field] for field in required}))
        except Exception as exc:  # a judge failure is a recorded error, never a score
            errors[name] = f"{type(exc).__name__}: {str(exc)[:200]}"
            continue
        if math.isnan(value) or not -1e-9 <= value <= 1.0 + 1e-9:
            errors[name] = f"Score out of range: {value}"
            continue
        scores[name] = min(max(value, 0.0), 1.0)  # float noise such as 1.0000000000000002
    return {"scores": scores, "errors": errors}


async def evaluate_answers(case_results, generate, scorers, prompt, top_k, concurrency=4):
    """Generate and score an answer for every case whose retrieval succeeded."""
    semaphore = asyncio.Semaphore(concurrency)

    async def one(result):
        row = {"id": result["id"], "group": result.get("group"), "retrieval_status": result["status"],
               "question": result.get("question"), "reference_answer": result.get("reference_answer"),
               "answer": None, "generation_error": None, "scores": {}, "errors": {}}
        chunks = result["ranked_chunks"][:top_k]
        async with semaphore:
            start = time.monotonic()
            try:
                row["answer"] = await generate(answer_messages(result["question"], chunks, prompt))
            except Exception as exc:
                row["generation_error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
                row["errors"] = {name: "Generation failed" for name in scorers}
                return row
            row["generation_seconds"] = time.monotonic() - start
            inputs = {"user_input": result["question"], "response": row["answer"],
                      "reference": result.get("reference_answer"),
                      "retrieved_contexts": [chunk["content"] for chunk in chunks]}
            row.update(await score_answer(inputs, scorers))
        return row

    eligible = [result for result in case_results if result.get("status") in ("scored", "not_scored")]
    return list(await asyncio.gather(*(one(result) for result in eligible)))


def aggregate_ragas(rows, metrics=RAGAS_METRICS):
    def summarize(subset):
        summary = {"count": len(subset), "generation_failed": sum(bool(r["generation_error"]) for r in subset)}
        for name in metrics:
            values = [r["scores"][name] for r in subset if name in r["scores"]]
            summary[name] = {"mean": sum(values) / len(values) if values else None, "n": len(values),
                             "errors": sum(name in r["errors"] for r in subset)}
        return summary

    groups = sorted({row["group"] for row in rows if row.get("group")})
    return {"overall": summarize(rows),
            "groups": {name: summarize([r for r in rows if r.get("group") == name]) for name in groups}}


def calibration_sample(rows, size=5, seed=20261107):
    """A fixed sample for a person to grade, to check the judge against human judgment."""
    candidates = sorted((r for r in rows if r["answer"] is not None), key=lambda r: r["id"])
    picked = random.Random(seed).sample(candidates, min(size, len(candidates)))
    return [{"id": r["id"], "question": r["question"], "reference_answer": r["reference_answer"],
             "answer": r["answer"], **{f"judge_{name}": r["scores"].get(name) for name in RAGAS_METRICS},
             **{f"human_{name}": None for name in RAGAS_METRICS}, "human_notes": ""} for r in picked]
