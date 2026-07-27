"use client";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
    label: string;
    loading: string;
};

// Issue #24 restyles this in place rather than replacing it: both auth forms
// depend on its useFormStatus() pending behaviour, and that is the part worth
// keeping. Only the className changed — the design's solid accent fill, uppercase
// label and 10px radius (the one soft edge in the system, see globals.css).
export function SubmitButton({ label, loading }: SubmitButtonProps) {
    const { pending } = useFormStatus();
    return (
        <button
            disabled={pending}
            type="submit"
            className="w-full flex items-center justify-center px-7 py-4 bg-orange-primary text-white font-semibold text-sm uppercase tracking-wider rounded-[0.625rem] hover:bg-orange-deep transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
            {pending ? loading : label}
        </button>
    );
}

