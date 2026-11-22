<script setup lang="ts">
import { ExternalLink } from "@lucide/vue";

useSeoMeta({
  title: "プライバシーポリシー",
  description: "CCSブログのプライバシーポリシー",
});
</script>

<template>
  <section class="prose">
    <h1>プライバシーポリシー</h1>
    <p>このサイトでは利用状況を分析するために Google アナリティクス を使用しています。</p>
    <p>Google アナリティクス は Cookie を使用して当サイトへのアクセス情報を Google に送信しています。</p>
    <p>
      このツールを通じて取得したデータは本サイト改善の目的に限って利用します。氏名、住所、電話番号、メールアドレス等の個人を直接特定する情報を取得することはありません。
    </p>
    <p>
      Google アナリティクス の規約の詳細に関しましては「<a
        href="https://marketingplatform.google.com/about/analytics/terms/jp/"
        target="_blank"
        rel="noopener noreferrer"
        >Google アナリティクス利用規約<ExternalLink class="external-link-icon" aria-hidden="true" /></a
      >」をご覧ください。
    </p>
    <p>
      Google アナリティクス におけるデータの収集・処理の仕組みについては「<a
        href="https://policies.google.com/technologies/partner-sites"
        target="_blank"
        rel="noopener noreferrer"
        >Google のサービスを使用するサイトやアプリから収集した情報の Google による使用<ExternalLink
          class="external-link-icon"
          aria-hidden="true" /></a
      >」をご覧ください。
    </p>
  </section>
</template>

<style scoped>
.external-link-icon {
  display: inline-block;
  width: 1em;
  height: 1em;
  margin-left: 0.25em;
  vertical-align: middle;
}
</style>
