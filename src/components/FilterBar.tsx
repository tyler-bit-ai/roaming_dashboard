"use client";

/**
 * 필터 툴바 — GET searchParams 기반 필터링
 * Meta FilterBar의 스타일 클래스(filter-control, filter-segment 등) 재사용
 * 조작 즉시 router.push로 URL을 갱신 → 서버 컴포넌트에서 재조회
 */
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import ToggleGroup from "./ToggleGroup";

export interface FilterValues {
  carrier: string; // 'ALL' | 'SKT' | 'KT' | 'LGU'
  category: string; // 'ALL' | 'plan' | 'service' | 'promotion'
  keyword: string; // 검색어
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD
  newsKeyword: string; // 뉴스 수집 키워드 (뉴스 페이지 전용)
}

interface FilterBarProps {
  initial: Partial<FilterValues>;
  /** 통신사 세그먼트 표시 여부 */
  showCarrier?: boolean;
  /** 카테고리 세그먼트 표시 여부 (요금제 페이지) */
  showCategory?: boolean;
  /** 수집 키워드 드롭다운 표시 여부 (뉴스 페이지) */
  showNewsKeyword?: boolean;
  /** 키워드 드롭다운 선택지 (DB의 DISTINCT query_keyword) */
  newsKeywordOptions?: string[];
}

const CARRIER_OPTIONS = [
  { value: "ALL", label: "전체" },
  { value: "SKT", label: "SKT", dotColor: "var(--color-skt)" },
  { value: "KT", label: "KT", dotColor: "var(--color-kt)" },
  { value: "LGU", label: "LGU+", dotColor: "var(--color-lgu)" },
];

const CATEGORY_OPTIONS = [
  { value: "ALL", label: "전체" },
  { value: "plan", label: "요금제" },
  { value: "service", label: "부가서비스" },
  { value: "promotion", label: "프로모션" },
];

export default function FilterBar({
  initial,
  showCarrier = true,
  showCategory = false,
  showNewsKeyword = false,
  newsKeywordOptions = [],
}: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const [values, setValues] = useState<FilterValues>({
    carrier: initial.carrier ?? "ALL",
    category: initial.category ?? "ALL",
    keyword: initial.keyword ?? "",
    dateFrom: initial.dateFrom ?? "",
    dateTo: initial.dateTo ?? "",
    newsKeyword: initial.newsKeyword ?? "ALL",
  });

  /** 변경 사항을 URL searchParams로 반영 */
  const apply = (next: Partial<FilterValues>, resetPage = true) => {
    const merged = { ...values, ...next };
    setValues(merged);
    const params = new URLSearchParams();
    if (merged.carrier && merged.carrier !== "ALL") params.set("carrier", merged.carrier);
    if (merged.category && merged.category !== "ALL") params.set("category", merged.category);
    if (merged.keyword.trim()) params.set("q", merged.keyword.trim());
    if (merged.dateFrom) params.set("from", merged.dateFrom);
    if (merged.dateTo) params.set("to", merged.dateTo);
    if (merged.newsKeyword && merged.newsKeyword !== "ALL") params.set("kw", merged.newsKeyword);
    if (resetPage) {
      // 페이지 파라미터는 유지하지 않음 — 필터 변경 시 1페이지로
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  const reset = () => {
    setValues({
      carrier: "ALL",
      category: "ALL",
      keyword: "",
      dateFrom: "",
      dateTo: "",
      newsKeyword: "ALL",
    });
    startTransition(() => {
      router.push(pathname);
    });
  };

  const hasActiveFilter =
    values.carrier !== "ALL" ||
    values.category !== "ALL" ||
    values.keyword.trim() !== "" ||
    values.dateFrom !== "" ||
    values.dateTo !== "" ||
    values.newsKeyword !== "ALL";

  return (
    <div
      className={`filter-toolbar sticky top-[57px] z-10 border-b border-[var(--surface-border)] bg-white/95 px-4 py-2.5 backdrop-blur md:px-8 ${
        pending ? "opacity-70" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* 검색 */}
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            apply({ keyword: values.keyword });
          }}
        >
          <span className="filter-search__icon pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            ⌕
          </span>
          <input
            type="search"
            value={values.keyword}
            onChange={(e) => setValues((v) => ({ ...v, keyword: e.target.value }))}
            placeholder="이름/제목 검색"
            className="filter-control filter-search__input h-[34px] w-[200px] rounded-md border border-[var(--surface-border)] bg-white pr-3 text-[12px] text-slate-700 focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]"
          />
        </form>

        {showCarrier && (
          <ToggleGroup options={CARRIER_OPTIONS} value={values.carrier} onChange={(v) => apply({ carrier: v })} />
        )}

        {showCategory && (
          <ToggleGroup options={CATEGORY_OPTIONS} value={values.category} onChange={(v) => apply({ category: v })} />
        )}

        {showNewsKeyword && (
          <select
            value={values.newsKeyword}
            onChange={(e) => apply({ newsKeyword: e.target.value })}
            className="filter-control h-[34px] rounded-md border border-[var(--surface-border)] bg-white px-2 text-[12px] text-slate-700 focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="ALL">전체 키워드</option>
            {newsKeywordOptions.map((kw) => (
              <option key={kw} value={kw}>
                {kw}
              </option>
            ))}
          </select>
        )}

        {/* 날짜 범위 */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={values.dateFrom}
            onChange={(e) => apply({ dateFrom: e.target.value })}
            className="filter-date-input"
            aria-label="시작 날짜"
          />
          <span className="text-[11px] text-slate-400">~</span>
          <input
            type="date"
            value={values.dateTo}
            onChange={(e) => apply({ dateTo: e.target.value })}
            className="filter-date-input"
            aria-label="종료 날짜"
          />
        </div>

        {hasActiveFilter && (
          <button onClick={reset} className="subtle-button text-[11px]" title="필터 초기화">
            ✕ 초기화
          </button>
        )}
      </div>
    </div>
  );
}
