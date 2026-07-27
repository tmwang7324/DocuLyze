"use client";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
    label: string;
    loading: string;
};

export function SubmitButton({ label, loading }: SubmitButtonProps) {
    const { pending } = useFormStatus();
    return (
        <button disabled={pending} type="submit" className="border-2 p-2 rounded">
            {pending ? loading : label}
        </button>
    );
}

