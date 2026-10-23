import React, { useState } from 'react';
import {
  Sparkles,
  Upload,
  X,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  ArrowRight,
  ShieldAlert,
  Loader2,
  FileQuestion,
  RefreshCw,
  Building,
  MapPin,
  Camera,
  Info
} from 'lucide-react';
import {
  TICKET_CATEGORIES,
  TicketCategory,
  AIAnalysis,
  DuplicateCandidate,
  CATEGORY_DEPARTMENT_ROUTING,
  Ticket
} from '../../shared/types.js';
import { CategoryBadge } from '../common/CategoryBadge.js';
import { aiSourceDetail, aiSourceTitle } from '../../shared/aiLabels.js';
import { apiClient } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.js';

interface ComplaintFormProps {
  onSuccess: (ticket: Ticket) => void;
  onNavigateToTrack: (ticketId: string) => void;
  onRequireSignIn: () => void;
  prefillData?: {
    building?: string;
    location?: string;
    description?: string;
  };
}

const COMMON_CAMPUS_BUILDINGS = [
  'Science & Engineering Complex',
  'Main Academic Quad',
  'Student Union Center',
  'University Memorial Library',
  'North Residential Hall',
  'South Quad Dorms',
  'Athletic & Recreation Pavilion',
  'Fine Arts & Design Building'
];

export const ComplaintForm: React.FC<ComplaintFormProps> = ({
  onSuccess,
  onNavigateToTrack,
  onRequireSignIn,
  prefillData
}) => {
  const { user } = useAuth();

  // Form fields
  const [building, setBuilding] = useState(prefillData?.building || '');
  const [location, setLocation] = useState(prefillData?.location || '');
  const [description, setDescription] = useState(prefillData?.description || '');
  const [selectedCategory, setSelectedCategory] = useState<TicketCategory>('Plumbing');
  const [categorySource, setCategorySource] = useState<'student' | 'ai_suggested'>('student');

  // Image upload
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  // AI Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCandidate[]>([]);
  const [similarReportsByOthers, setSimilarReportsByOthers] = useState(0);
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<string, string>>({});
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Handle Photo selection
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImageError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size < 5MB
    if (file.size > 5 * 1024 * 1024) {
      setImageError('Photo size exceeds 5MB. Please upload a smaller image.');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setImageError('Please select a valid image file (JPEG, PNG, WebP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUri = event.target?.result as string;
      setImagePreviewUrl(dataUri);
      setImageMimeType(file.type);
      setImageBase64(dataUri);
    };
    reader.onerror = () => {
      setImageError('Failed to read image file.');
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = () => {
    setImageBase64(null);
    setImageMimeType(null);
    setImagePreviewUrl(null);
    setImageError(null);
  };

  // Run Gemini Triage
  const handleAnalyzeWithAI = async () => {
    if (!description.trim()) {
      setAnalysisError('Please enter a description of the issue first.');
      return;
    }

    if (!user) {
      setAnalysisError('Please sign in to use AI suggestions. Your draft will be kept.');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const response = await apiClient.analyzeComplaint({
        description: description.trim(),
        building: building.trim() || undefined,
        location: location.trim() || undefined,
        imageBase64: imageBase64 || undefined,
        mimeType: imageMimeType || undefined
      });

      if (response.success && response.analysis) {
        setAiAnalysis(response.analysis);
        setAnalysisId(response.analysisId);
        setSelectedCategory(response.analysis.suggestedCategory);
        setCategorySource('ai_suggested');
        setDuplicateCandidates(response.duplicateCandidates || []);
        setSimilarReportsByOthers(response.similarReportsByOthers || 0);

        // Initialize follow-up answers structure
        const initialAnswers: Record<string, string> = {};
        response.analysis.followUpQuestions.forEach((q, idx) => {
          initialAnswers[`q_${idx}`] = '';
        });
        setFollowUpAnswers(initialAnswers);
      } else {
        setAnalysisError(response.message || 'AI service analysis did not return results.');
      }
    } catch (err: any) {
      setAnalysisError(err.message || 'Could not connect to AI triage service.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Handle follow up answer change
  const handleAnswerChange = (key: string, val: string) => {
    setFollowUpAnswers(prev => ({ ...prev, [key]: val }));
  };

  // Submit Complaint
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!building.trim()) {
      setSubmitError('Please select or specify a campus building.');
      return;
    }

    if (!location.trim()) {
      setSubmitError('Please specify the exact room, floor, or area.');
      return;
    }

    if (!description.trim()) {
      setSubmitError('Please provide a description of the issue.');
      return;
    }

    if (!user) {
      setSubmitError('Please sign in to submit your complaint. Your draft will be kept.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Append follow-up answers into description if provided
      let finalDescription = description.trim();
      const answeredList: Record<string, string> = {};

      if (aiAnalysis && aiAnalysis.followUpQuestions.length > 0) {
        const addedNotes: string[] = [];
        aiAnalysis.followUpQuestions.forEach((q, idx) => {
          const ans = followUpAnswers[`q_${idx}`]?.trim();
          if (ans) {
            addedNotes.push(`Q: ${q}\nA: ${ans}`);
            answeredList[q] = ans;
          }
        });

        if (addedNotes.length > 0) {
          finalDescription += `\n\n[Clarification Details Provided by Student]:\n${addedNotes.join('\n')}`;
        }
      }

      const res = await apiClient.submitComplaint({
        description: finalDescription,
        building: building.trim(),
        location: location.trim(),
        category: selectedCategory,
        categorySource,
        imageBase64: imageBase64 || undefined,
        mimeType: imageMimeType || undefined,
        analysisId: analysisId || undefined,
        studentFollowUpAnswers: Object.keys(answeredList).length > 0 ? answeredList : undefined
      });

      if (res.success && res.ticket) {
        onSuccess(res.ticket);
      } else {
        setSubmitError(res.error || 'Failed to submit complaint.');
      }
    } catch (err: any) {
      setSubmitError(err.message || 'Error communicating with ticket server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Form Header */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 text-white p-6 sm:p-8">
        <div className="flex items-center gap-2 text-blue-200 text-xs font-semibold uppercase tracking-wider mb-2">
          <Building size={14} />
          <span>Student Maintenance Request</span>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">
          Report a Campus Facility Issue
        </h2>
        <p className="text-blue-100 text-sm max-w-xl">
          Describe the problem in your own words. Optional AI suggestions can help pick a category and spot missing details; you can always edit them or submit without AI.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6">
        {/* Error message */}
        {submitError && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Submission Incomplete</p>
              <p>{submitError}</p>
            </div>
          </div>
        )}

        {/* Section 1: Location */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <MapPin size={14} className="text-blue-600" />
            <span>1. Location Details</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Campus Building <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  list="campus-buildings"
                  value={building}
                  onChange={(e) => setBuilding(e.target.value)}
                  placeholder="e.g. Science & Engineering Complex"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 bg-slate-50/50"
                />
                <datalist id="campus-buildings">
                  {COMMON_CAMPUS_BUILDINGS.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Room Number, Floor, or Area <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Room 204 or 2nd Floor West Washroom"
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 bg-slate-50/50"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Complaint Description */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
              2. Describe the Maintenance Issue <span className="text-rose-500">*</span>
            </label>
            <span className="text-xs text-slate-400">
              Natural language welcome
            </span>
          </div>

          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what's wrong. For example: 'The washbasin pipe in the 2nd floor restroom is dripping water steadily onto the floor, making it slippery' or 'Projector outlet in Hall 101 sparked when plugged in'."
            required
            className="w-full px-3.5 py-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 bg-slate-50/50 leading-relaxed"
          />

          {/* AI Triage Trigger CTA */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={handleAnalyzeWithAI}
              disabled={isAnalyzing || !description.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 size={14} className="animate-spin text-indigo-600" />
                  <span>Getting suggestions...</span>
                </>
              ) : (
                <>
                  <Sparkles size={14} className="text-indigo-600" />
                  <span>Get AI Suggestions (optional)</span>
                </>
              )}
            </button>

            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <Info size={12} />
              <span>AI suggests category &amp; asks follow-ups</span>
            </span>
          </div>

          {analysisError && (
            <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
              {analysisError}
            </p>
          )}
        </div>

        {/* Section 3: AI Analysis Results Card (if generated) */}
        {aiAnalysis && (
          <div className="p-5 rounded-2xl bg-indigo-50/60 border border-indigo-100 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                  <Sparkles size={15} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-indigo-950 uppercase tracking-wider">
                    {aiSourceTitle(aiAnalysis)}
                  </h4>
                  <p className="text-xs text-indigo-700">
                    {aiSourceDetail(aiAnalysis)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">
                  Confidence: {aiAnalysis.confidence} ({Math.round(aiAnalysis.confidenceScore * 100)}%)
                </span>
                {aiAnalysis.urgencyAssessment === 'Safety Hazard' && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
                    <ShieldAlert size={12} />
                    Safety Hazard
                  </span>
                )}
              </div>
            </div>

            {/* Problem Summary & Routing */}
            <div className="bg-white p-3.5 rounded-xl border border-indigo-100/80 space-y-2 text-xs">
              <div>
                <span className="text-slate-400 font-medium">AI Problem Summary:</span>
                <p className="text-slate-800 font-medium mt-0.5 text-sm">
                  "{aiAnalysis.conciseSummary}"
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-slate-100 text-slate-600">
                <div>
                  <span className="text-slate-400">Suggested Category: </span>
                  <CategoryBadge category={aiAnalysis.suggestedCategory} size="sm" />
                </div>
                <div>
                  <span className="text-slate-400">Recommended Routing: </span>
                  <span className="font-semibold text-slate-800">{aiAnalysis.recommendedDepartment}</span>
                </div>
              </div>
            </div>

            {/* Missing details and follow-up inquiry */}
            {aiAnalysis.followUpQuestions.length > 0 && (
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900">
                  <FileQuestion size={14} className="text-indigo-600" />
                  <span>Missing Details Identified — Clarify to speed up resolution:</span>
                </div>

                <div className="space-y-2">
                  {aiAnalysis.followUpQuestions.map((q, idx) => (
                    <div key={idx} className="bg-white p-3 rounded-xl border border-indigo-100">
                      <label className="block text-xs font-medium text-slate-800 mb-1.5">
                        {q}
                      </label>
                      <input
                        type="text"
                        value={followUpAnswers[`q_${idx}`] || ''}
                        onChange={(e) => handleAnswerChange(`q_${idx}`, e.target.value)}
                        placeholder="Type answer here..."
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Section 4: Duplicate Warning Alert (if any active matching tickets exist) */}
        {duplicateCandidates.length > 0 && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-2">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                  Possible Existing Maintenance Report ({duplicateCandidates.length})
                </h4>
                <p className="text-xs text-amber-800 mt-0.5">
                  A similar issue in this location has already been reported. You can check the existing ticket or proceed with your submission:
                </p>
              </div>
            </div>

            <div className="space-y-1.5 pl-6">
              {duplicateCandidates.map((dup) => (
                <div
                  key={dup.ticketId}
                  className="bg-white/80 p-2.5 rounded-lg border border-amber-200 text-xs flex items-center justify-between gap-3"
                >
                  <div>
                    <span className="font-mono font-bold text-blue-700 mr-2">{dup.ticketId}</span>
                    <span className="font-medium text-slate-800">{dup.title}</span>
                    <p className="text-[11px] text-slate-500 mt-0.5">{dup.matchReason}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigateToTrack(dup.ticketId)}
                    className="shrink-0 px-2.5 py-1 text-xs font-semibold bg-amber-100 text-amber-900 rounded-md hover:bg-amber-200 transition-colors"
                  >
                    View Ticket
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {similarReportsByOthers > 0 && (
          <p className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700" role="status">
            {similarReportsByOthers === 1
              ? 'One similar open report from another person may already exist.'
              : `${similarReportsByOthers} similar open reports from other people may already exist.`}{' '}
            Staff will review possible duplicates. Please still submit if this affects you.
          </p>
        )}

        {/* Section 5: Category Selection (Explicit 4 categories) */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
              3. Category Selection <span className="text-rose-500">*</span>
            </label>
            <span className="text-xs text-slate-400">
              Exactly 4 supported campus categories
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {TICKET_CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat;
              return (
                <button
                  type="button"
                  key={cat}
                  onClick={() => {
                    setSelectedCategory(cat);
                    setCategorySource('student');
                  }}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between h-20 ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20 shadow-xs'
                      : 'border-slate-200 hover:border-slate-300 bg-slate-50/40 text-slate-700'
                  }`}
                >
                  <CategoryBadge category={cat} size="sm" />
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2">
                    <span>{isSelected ? '✓ Selected' : 'Choose'}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <p className="text-[11px] text-slate-400">
            Selected department routing:{' '}
            <strong className="text-slate-700 font-medium">
              {CATEGORY_DEPARTMENT_ROUTING[selectedCategory]}
            </strong>
          </p>
        </div>

        {/* Section 6: Optional Photo Upload */}
        <div className="space-y-2.5">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>4. Attach Photo (Optional)</span>
            <span className="text-xs text-slate-400 font-normal">Max 5MB (JPEG, PNG, WebP)</span>
          </label>

          {imagePreviewUrl ? (
            <div className="relative rounded-xl border border-slate-200 p-2 bg-slate-50 flex items-center gap-4">
              <img
                src={imagePreviewUrl}
                alt="Complaint attachment"
                className="w-24 h-24 object-cover rounded-lg border border-slate-300"
              />
              <div className="space-y-1 text-xs">
                <p className="font-semibold text-slate-800">Photo attached</p>
                <p className="text-slate-500">Shared with facilities staff. Included in AI suggestions only if you request them and AI is available.</p>
                <button
                  type="button"
                  onClick={removePhoto}
                  className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-700 font-medium pt-1"
                >
                  <X size={14} />
                  <span>Remove photo</span>
                </button>
              </div>
            </div>
          ) : (
            <label className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl p-6 text-center cursor-pointer transition-colors block bg-slate-50/40 hover:bg-blue-50/20">
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="hidden"
              />
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Camera size={18} />
                </div>
                <div>
                  <span className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                    Click to upload a photo
                  </span>{' '}
                  <span className="text-xs text-slate-500">or drag and drop</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Photos help maintenance staff locate fixtures and bring correct tools
                </p>
              </div>
            </label>
          )}

          {imageError && (
            <p className="text-xs text-rose-600 font-medium">{imageError}</p>
          )}
        </div>

        {/* Submit Actions */}
        <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          {user ? (
            <p className="text-[11px] text-slate-500 text-center sm:text-left">
              Submitting as <strong className="text-slate-700">{user.name}</strong> ({user.email}). Your name is visible to facilities staff.
            </p>
          ) : (
            <p className="text-[11px] text-slate-600 text-center sm:text-left">
              You must be signed in to submit.{' '}
              <button
                type="button"
                onClick={onRequireSignIn}
                className="font-semibold text-blue-700 underline hover:text-blue-800 cursor-pointer"
              >
                Sign in
              </button>{' '}
              — your draft stays on this page.
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full sm:w-auto px-6 py-3 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Creating Ticket...</span>
              </>
            ) : (
              <>
                <span>Submit Maintenance Request</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
