{{/*
Expand the name of the chart.
*/}}
{{- define "sentinel.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this.
*/}}
{{- define "sentinel.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart label.
*/}}
{{- define "sentinel.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "sentinel.labels" -}}
helm.sh/chart: {{ include "sentinel.chart" . }}
{{ include "sentinel.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "sentinel.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sentinel.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
API component labels.
*/}}
{{- define "sentinel.api.labels" -}}
{{ include "sentinel.labels" . }}
app.kubernetes.io/component: api
{{- end }}

{{- define "sentinel.api.selectorLabels" -}}
{{ include "sentinel.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
Web component labels.
*/}}
{{- define "sentinel.web.labels" -}}
{{ include "sentinel.labels" . }}
app.kubernetes.io/component: web
{{- end }}

{{- define "sentinel.web.selectorLabels" -}}
{{ include "sentinel.selectorLabels" . }}
app.kubernetes.io/component: web
{{- end }}

{{/*
Runner component labels.
*/}}
{{- define "sentinel.runner.labels" -}}
{{ include "sentinel.labels" . }}
app.kubernetes.io/component: runner
{{- end }}

{{- define "sentinel.runner.selectorLabels" -}}
{{ include "sentinel.selectorLabels" . }}
app.kubernetes.io/component: runner
{{- end }}

{{/*
Image pull secrets.
*/}}
{{- define "sentinel.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Full image name with optional registry prefix.
Usage: {{ include "sentinel.image" (dict "registry" .Values.global.imageRegistry "repo" .Values.api.image.repository "tag" .Values.api.image.tag) }}
*/}}
{{- define "sentinel.image" -}}
{{- $registry := .registry -}}
{{- $repo := .repo -}}
{{- $tag := .tag | default "latest" -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $repo $tag -}}
{{- else -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
{{- end }}

{{/*
ConfigMap name.
*/}}
{{- define "sentinel.configmap" -}}
{{- printf "%s-config" (include "sentinel.fullname" .) }}
{{- end }}

{{/*
Secret name — use existingSecret if set, otherwise the chart-managed one.
*/}}
{{- define "sentinel.secretName" -}}
{{- if .Values.api.existingSecret -}}
{{- .Values.api.existingSecret -}}
{{- else -}}
{{- printf "%s-secret" (include "sentinel.fullname" .) -}}
{{- end -}}
{{- end }}
