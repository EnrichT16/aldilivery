import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { storeConfig } from '../config';
import { buyRecipePass } from '../lib/api';
import { addNamedItems, listInWords, RECIPES, recipePassActive, type Recipe } from '../lib/extras';
import { money } from '../lib/money';
import { useBasket } from '../state/basket';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

/**
 * Ozi Recipes (Anthony, 6 October 2026), a paid extra. Everybody can see each recipe's name,
 * what it is and its ingredients. The method, read out by Ozi, and putting every ingredient in
 * the basket in one go need the Recipe Pass: a small price for a number of days, agreed before
 * it is taken from the saved card, never renewing by itself.
 */
export function Recipes(): JSX.Element {
  const { shopper, replaceShopper } = useSession();
  const basket = useBasket();
  const ozi = useOzi();
  const navigate = useNavigate();
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const { recipePassPence, recipePassDays } = storeConfig.extras;
  const price = money(recipePassPence);
  const unlocked = recipePassActive(shopper?.recipePassUntil);

  async function unlock(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await buyRecipePass();
      if (shopper) replaceShopper({ ...shopper, recipePassUntil: result.recipePassUntil });
      setConfirming(false);
      setNews(result.message);
      void ozi.say(`${result.message} Which recipe would you like?`);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'That did not work.';
      setProblem(message);
      void ozi.say(message);
    } finally {
      setBusy(false);
    }
  }

  async function addAll(recipe: Recipe): Promise<void> {
    const { added, missing } = await addNamedItems(recipe.ingredients, basket);
    const words =
      `I've put the ingredients for ${recipe.name} in your basket: ${listInWords(added)}.` +
      (missing.length > 0 ? ` I couldn't find ${listInWords(missing)}.` : '') +
      ' Shall we look at your basket?';
    setNews(words);
    ozi.listenFor(words, (heard) => {
      if (/\b(yes|yeah|ok|okay|please|sure)\b/i.test(heard)) navigate('/basket');
    });
  }

  function readMethod(recipe: Recipe): void {
    void ozi.say(
      `${recipe.name}, for ${recipe.serves}. ` +
        recipe.method.map((step, index) => `Step ${index + 1}. ${step}`).join(' ') +
        ' Enjoy your meal.',
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">{storeConfig.assistantName} Recipes</h1>
      <p className="m-0 max-w-xl">
        Simple, healthy meals from everyday shopping. {storeConfig.assistantName} reads each one
        out, step by step, and puts every ingredient in your basket in one go.
      </p>
      <p role="status" className="m-0 min-h-control max-w-xl">
        {news}
      </p>
      {problem !== '' && (
        <p
          role="alert"
          className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0 max-w-xl"
        >
          {problem}
        </p>
      )}

      {!unlocked && (
        <section
          aria-labelledby="pass-heading"
          className="space-y-3 max-w-xl border-2 border-highlight rounded-xl p-4"
        >
          <h2 id="pass-heading" className="text-lead font-bold m-0">
            Recipe Pass: {price} for {recipePassDays} days
          </h2>
          <p className="m-0">
            Unlocks every recipe&rsquo;s method, read aloud, and adding all the ingredients at once.
            It does not renew by itself.
          </p>
          {!shopper ? (
            <Link to="/sign-up" className="control bg-highlight text-ink">
              Set up an account first
            </Link>
          ) : confirming ? (
            <>
              <p className="m-0 font-bold">
                {price} will be taken from your saved card now, for {recipePassDays} days of
                Recipes. Is that all right?
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void unlock()}
                className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
              >
                Yes, unlock Recipes for {price}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="control bg-paper/10 text-paper underline"
              >
                Not now
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="control w-full bg-highlight text-ink text-lead"
            >
              Unlock Recipes
            </button>
          )}
        </section>
      )}

      <ul className="list-none m-0 p-0 space-y-6 max-w-xl">
        {RECIPES.map((recipe) => (
          <li key={recipe.id}>
            <article
              aria-labelledby={`recipe-${recipe.id}`}
              className="space-y-3 border-2 border-paper rounded-xl p-4"
            >
              <h2 id={`recipe-${recipe.id}`} className="text-lead font-bold m-0">
                {recipe.name}
              </h2>
              <p className="m-0">
                {recipe.summary} Serves {recipe.serves}, about {recipe.minutes} minutes.
              </p>
              <h3 className="font-bold m-0">You need</h3>
              <ul className="m-0 ps-6">
                {recipe.ingredients.map((ingredient) => (
                  <li key={ingredient.item}>{ingredient.item}</li>
                ))}
              </ul>
              {unlocked ? (
                <>
                  <h3 className="font-bold m-0">Method</h3>
                  <ol className="m-0 ps-6 space-y-1">
                    {recipe.method.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <button
                    type="button"
                    onClick={() => readMethod(recipe)}
                    className="control w-full bg-paper text-ink"
                  >
                    Read me the recipe
                  </button>
                  <button
                    type="button"
                    onClick={() => void addAll(recipe)}
                    className="control w-full bg-highlight text-ink"
                  >
                    Add all the ingredients to my basket
                  </button>
                </>
              ) : (
                <p className="m-0">
                  The method and adding everything at once come with the Recipe Pass.
                </p>
              )}
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
